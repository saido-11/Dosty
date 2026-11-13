using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace Dosty
{
    internal static class InputBridge
    {
        private const uint WM_DESTROY = 0x0002;
        private const uint WM_CLOSE = 0x0010;
        private const uint WM_INPUT_DEVICE_CHANGE = 0x00FE;
        private const uint WM_INPUT = 0x00FF;
        private const uint GIDC_REMOVAL = 2;
        private const uint RID_INPUT = 0x10000003;
        private const uint RIDEV_INPUTSINK = 0x00000100;
        private const uint RIDEV_DEVNOTIFY = 0x00002000;
        private const uint RIM_TYPEMOUSE = 0;
        private const uint RIM_TYPEKEYBOARD = 1;
        private const int RawMouseSize = 24;
        private const int RawMouseButtonsOffset = 4; // ULONG-aligned union after usFlags
        private const ushort RI_KEY_BREAK = 0x0001;
        private const ushort RI_KEY_PREFIX = 0x0006; // E0 and E1
        private const ushort RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001;
        private const ushort RI_MOUSE_LEFT_BUTTON_UP = 0x0002;
        private const ushort RI_MOUSE_RIGHT_BUTTON_DOWN = 0x0004;

        private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        // Keep the delegate alive while the native window exists.
        private static readonly WindowProcedure Callback = WindowCallback;
        private static readonly IntPtr MessageOnlyWindow = new IntPtr(-3);
        private static readonly uint HeaderSize = (uint)Marshal.SizeOf(typeof(RawInputHeader));
        private static readonly uint KeyboardSize = (uint)Marshal.SizeOf(typeof(RawKeyboard));
        private static readonly uint BufferSize = HeaderSize + Math.Max((uint)RawMouseSize, KeyboardSize);

        // Temporary state for repeat suppression and left-button dragging. No text is
        // decoded, and neither key IDs nor device handles leave the bridge.
        private static readonly Dictionary<IntPtr, HashSet<int>> HeldKeys =
            new Dictionary<IntPtr, HashSet<int>>();
        private static readonly HashSet<IntPtr> LeftButtons = new HashSet<IntPtr>();
        private static IntPtr _buffer;

        [StructLayout(LayoutKind.Sequential)]
        private struct Message
        {
            public IntPtr window;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int x;
            public int y;
            public uint reserved;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WindowClass
        {
            public uint style;
            public WindowProcedure procedure;
            public int classExtra;
            public int windowExtra;
            public IntPtr instance;
            public IntPtr icon;
            public IntPtr cursor;
            public IntPtr background;
            public string menuName;
            public string className;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RawInputDevice
        {
            public ushort usagePage;
            public ushort usage;
            public uint flags;
            public IntPtr target;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RawInputHeader
        {
            public uint type;
            public uint size;
            public IntPtr device;
            public IntPtr wParam;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RawKeyboard
        {
            public ushort makeCode;
            public ushort flags;
            public ushort reserved;
            public ushort virtualKey;
            public uint message;
            public uint extraInformation;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string moduleName);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern ushort RegisterClass(ref WindowClass windowClass);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWindowEx(uint extendedStyle, string className, string title,
            uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
            IntPtr instance, IntPtr parameter);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool DestroyWindow(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr DispatchMessage(ref Message message);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern void PostQuitMessage(int exitCode);

        [DllImport("user32.dll")]
        private static extern bool RegisterRawInputDevices(RawInputDevice[] devices, uint count, uint size);

        [DllImport("user32.dll")]
        private static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size,
            uint headerSize);

        private static int Main(string[] args)
        {
            Console.Out.NewLine = "\n";
            foreach (string arg in args)
            {
                if (arg == "--check-permission" || arg == "--request-permission")
                {
                    Report("P:1");
                    return 0;
                }
            }

            const string className = "DostyRawInput";
            IntPtr instance = GetModuleHandle(null);
            WindowClass windowClass = new WindowClass
            {
                instance = instance,
                procedure = Callback,
                className = className
            };
            if (RegisterClass(ref windowClass) == 0) return StartupFailed();

            IntPtr window = CreateWindowEx(0, className, className, 0, 0, 0, 0, 0,
                MessageOnlyWindow, IntPtr.Zero, instance, IntPtr.Zero);
            if (window == IntPtr.Zero) return StartupFailed();

            _buffer = Marshal.AllocHGlobal((int)BufferSize);
            try
            {
                // INPUTSINK delivers events when another window has focus. Do not use
                // NOLEGACY: the foreground app should still receive its normal input.
                const uint flags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY;
                RawInputDevice[] devices = {
                    new RawInputDevice { usagePage = 1, usage = 2, flags = flags, target = window }, // Mouse
                    new RawInputDevice { usagePage = 1, usage = 6, flags = flags, target = window }  // Keyboard
                };
                if (!RegisterRawInputDevices(devices, (uint)devices.Length,
                    (uint)Marshal.SizeOf(typeof(RawInputDevice)))) return StartupFailed();

                Report("P:1");

                Thread stdinWatcher = new Thread(delegate() { WatchParentStdin(window); });
                stdinWatcher.IsBackground = true;
                stdinWatcher.Start();

                Message message;
                int result;
                while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0)
                {
                    DispatchMessage(ref message);
                }
                return result == 0 ? 0 : 1;
            }
            finally
            {
                if (IsWindow(window)) DestroyWindow(window);
                Marshal.FreeHGlobal(_buffer);
            }
        }

        private static int StartupFailed()
        {
            Report("P:0");
            return 1;
        }

        private static void Report(string signal)
        {
            Console.WriteLine(signal);
            Console.Out.Flush();
        }

        private static void WatchParentStdin(IntPtr window)
        {
            try
            {
                while (Console.In.Read() != -1) { }
            }
            catch (System.IO.IOException) { }

            PostMessage(window, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        }

        private static IntPtr WindowCallback(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                switch (message)
                {
                    case WM_INPUT:
                        ReadInput(lParam);
                        // DefWindowProc performs required cleanup for foreground input.
                        break;
                    case WM_INPUT_DEVICE_CHANGE:
                        if (wParam.ToInt64() == GIDC_REMOVAL)
                        {
                            HeldKeys.Remove(lParam);
                            if (LeftButtons.Remove(lParam) && LeftButtons.Count == 0) Report("L:0");
                        }
                        return IntPtr.Zero;
                    case WM_DESTROY:
                        PostQuitMessage(0);
                        return IntPtr.Zero;
                }
            }
            catch (System.IO.IOException)
            {
                // The parent closed its pipe. Exit through the message pump.
                PostQuitMessage(0);
            }
            return DefWindowProc(window, message, wParam, lParam);
        }

        private static void ReadInput(IntPtr input)
        {
            uint capacity = BufferSize;
            uint count = GetRawInputData(input, RID_INPUT, _buffer, ref capacity, HeaderSize);
            if (count < HeaderSize || count > BufferSize) return;

            RawInputHeader header = (RawInputHeader)Marshal.PtrToStructure(_buffer, typeof(RawInputHeader));
            IntPtr payload = IntPtr.Add(_buffer, (int)HeaderSize);
            if (header.type == RIM_TYPEMOUSE && count >= HeaderSize + RawMouseSize)
            {
                // Mouse movement is much more frequent than clicks. Ignore it without
                // allocating an object or writing it to the parent.
                ushort buttons = (ushort)Marshal.ReadInt16(payload, RawMouseButtonsOffset);
                if (buttons != 0) HandleMouse(header.device, buttons);
            }
            else if (header.type == RIM_TYPEKEYBOARD && count >= HeaderSize + KeyboardSize)
            {
                RawKeyboard key = (RawKeyboard)Marshal.PtrToStructure(payload, typeof(RawKeyboard));
                HandleKey(header.device, key);
            }
        }

        private static void HandleMouse(IntPtr device, ushort buttons)
        {
            if ((buttons & RI_MOUSE_LEFT_BUTTON_DOWN) != 0 &&
                LeftButtons.Add(device) && LeftButtons.Count == 1)
            {
                Report("L:1");
            }
            if ((buttons & (RI_MOUSE_LEFT_BUTTON_DOWN | RI_MOUSE_RIGHT_BUTTON_DOWN)) != 0)
            {
                Report("M");
            }
            if ((buttons & RI_MOUSE_LEFT_BUTTON_UP) != 0 &&
                LeftButtons.Remove(device) && LeftButtons.Count == 0)
            {
                Report("L:0");
            }
        }

        private static void HandleKey(IntPtr device, RawKeyboard key)
        {
            if (key.makeCode == 0xff || key.virtualKey == 0 || key.virtualKey >= 0xff) return;
            // Physical scan code (including E0/E1) distinguishes e.g. both Ctrl keys.
            int keyId = key.makeCode != 0
                ? (key.makeCode << 3) | (key.flags & RI_KEY_PREFIX)
                : 0x80000 | key.virtualKey;

            HashSet<int> held;
            if ((key.flags & RI_KEY_BREAK) != 0)
            {
                if (HeldKeys.TryGetValue(device, out held)) held.Remove(keyId);
                return;
            }
            if (!HeldKeys.TryGetValue(device, out held))
            {
                held = new HashSet<int>();
                HeldKeys.Add(device, held);
            }
            // Pause has no break event on standard keyboards.
            if (key.virtualKey == 0x13 || held.Add(keyId)) Report("K");
        }
    }
}
