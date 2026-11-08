# Character-generation prompt for Dosty

[Türkçe](character-prompt.tr.md) · [English README](../README.md)

Copy the text below into ChatGPT with image generation. Fill in the bracketed fields and attach reference images if available.

```text
Create a consistent character image set for a desktop application that reacts to keyboard presses and mouse clicks.

MY CHARACTER: [Describe your character or its appearance here.]
NUMBER OF POSES: [Choose 4 or 5. Default is 4.]
OUTPUT: [Choose separate PNG files or a 2×2 sprite sheet. Default is separate PNGs.]

REFERENCE IMAGES
If I attach a character photo or drawing, use its face, hair, colors, clothing, and distinctive features as the character reference. If no reference is attached, use my written description.
If a second image shows an example character at a keyboard and mouse, use it as a reference for illustration style, framing, and layout. Take my character’s identity from the first image.

APPEARANCE AND COMPOSITION
Draw a polished, cute, elegant 2D chibi character with a large head, small upper body, clean outlines, and soft shading. Keep it readable at a small display size.
Use a front view with the face and both hands or paws visible. Keep the mouth closed with a subtle smile.
Place the keyboard across the lower left and center of the image, and the mouse at the lower right. The hand on the viewer’s left operates the keyboard. The hand on the viewer’s right operates the mouse.
Keep the entire character, keyboard, and mouse inside the frame, with at least 5% padding on every side.

FILES AND POSES

1. idle.png — Eyes open. Keyboard hand slightly raised just above the keys, ready to press. Mouse hand resting comfortably on the mouse.
2. keyboard.png — Only the keyboard hand moves down to press a key. Mouse hand remains in its idle pose.
3. mouse.png — Keyboard hand remains in its idle pose. The mouse hand’s finger or paw presses a mouse button.
4. both.png — Keyboard hand and mouse hand press simultaneously.
5. blink.png — Include only when 5 poses are selected. Identical to idle.png, with the eyes naturally closed.

ALIGNMENT
Create the idle.png design first, then derive the remaining poses through localized edits to that same artwork.
Keep the canvas, camera, scale, character position, head, body, hair, clothing, keyboard, and mouse fixed across all poses. Change only the relevant hand, finger, paw, or eyes.
Make the movements small but clearly visible. Show a mouse click through an actual finger or paw movement.
Keep identical framing throughout. Disable automatic cropping, recentering, and zoom changes between images.

TECHNICAL OUTPUT
For separate files, produce each pose as an individual 1024×1024 PNG with genuine alpha transparency. All files must share the same canvas size and alignment.
For a 2×2 sheet, produce one transparent 2048×2048 PNG containing four equal 1024×1024 cells. Place idle at top left, keyboard at top right, mouse at bottom left, and both at bottom right. If a fifth pose is requested, supply blink.png separately.
If you cannot provide the exact dimensions or separate files, state that limitation. If you can generate only one image at a time, generate idle first, then continue with the remaining poses by editing that same image.

Keep the background fully transparent. Exclude checkerboard patterns, solid backgrounds, rooms, desk surfaces, text, labels, watermarks, panel borders, motion lines, and click effects. Do not paint a transparency pattern into the image.
```
