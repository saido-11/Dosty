using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace Dosty
{
    internal static class InputBridge
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WH_MOUSE_LL = 14;

        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;
        private const int WM_QUIT = 0x0012;

        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_LBUTTONUP = 0x0202;
        private const int WM_RBUTTONDOWN = 0x0204;

        private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

        // Static references prevent GC collection while Win32 hooks are active.
        private static readonly LowLevelProc KeyboardDelegate = KeyboardCallback;
        private static readonly LowLevelProc MouseDelegate = MouseCallback;

        // Only momentary physical key-down boolean flags are kept in memory.
        // No virtual key names, characters, or typed text are ever created or stored.
        private static readonly bool[] KeyDownState = new bool[256];

        private static IntPtr _keyboardHook = IntPtr.Zero;
        private static IntPtr _mouseHook = IntPtr.Zero;
        private static uint _mainThreadId;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        private static int Main(string[] args)
        {
            Console.Out.NewLine = "\n";
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--check-permission" || args[i] == "--request-permission")
                {
                    Console.WriteLine("P:1");
                    Console.Out.Flush();
                    return 0;
                }
            }

            _mainThreadId = GetCurrentThreadId();

            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                IntPtr moduleHandle = GetModuleHandle(curModule.ModuleName);
                _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardDelegate, moduleHandle, 0);
                _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, MouseDelegate, moduleHandle, 0);
            }

            if (_keyboardHook == IntPtr.Zero || _mouseHook == IntPtr.Zero)
            {
                Console.WriteLine("P:0");
                Console.Out.Flush();
                Cleanup();
                return 1;
            }

            Console.WriteLine("P:1");
            Console.Out.Flush();

            Thread stdinWatcher = new Thread(WatchParentStdin);
            stdinWatcher.IsBackground = true;
            stdinWatcher.Start();

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                // Low-level hooks are dispatched directly by GetMessage.
            }

            Cleanup();
            return 0;
        }

        private static void WatchParentStdin()
        {
            try
            {
                while (Console.In.Read() != -1)
                {
                }
            }
            catch
            {
            }

            PostThreadMessage(_mainThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        private static void Cleanup()
        {
            if (_keyboardHook != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_keyboardHook);
                _keyboardHook = IntPtr.Zero;
            }
            if (_mouseHook != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_mouseHook);
                _mouseHook = IntPtr.Zero;
            }
        }

        private static IntPtr KeyboardCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                int vkCode = Marshal.ReadInt32(lParam);

                if (vkCode >= 0 && vkCode < 256)
                {
                    if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                    {
                        if (!KeyDownState[vkCode])
                        {
                            KeyDownState[vkCode] = true;
                            Console.WriteLine("K");
                            Console.Out.Flush();
                        }
                    }
                    else if (msg == WM_KEYUP || msg == WM_SYSKEYUP)
                    {
                        KeyDownState[vkCode] = false;
                    }
                }
            }
            return CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
        }

        private static IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                if (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP)
                {
                    Console.WriteLine(msg == WM_LBUTTONDOWN ? "L:1" : "L:0");
                    Console.Out.Flush();
                }
                if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN)
                {
                    Console.WriteLine("M");
                    Console.Out.Flush();
                }
            }
            return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
        }
    }
}
