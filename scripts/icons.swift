// Draws the app's icons, 🚁 in Apple's emoji font, into public/: `swift scripts/icons.swift`.
// On a transparent background for the browser and the home screen (iOS fills the empty part in black), and one with
// room around it on the page's colour for Android's masks.
import AppKit

func draw(size: Int, emojiShare: CGFloat, background: NSColor?, to file: String) throws {
  let side = CGFloat(size)
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
  else { throw NSError(domain: "icons", code: 1) }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  if let background {
    background.setFill()
    NSRect(x: 0, y: 0, width: side, height: side).fill()
  } else {
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: side, height: side).fill(using: .copy)
  }
  let text = NSAttributedString(
    string: "🚁", attributes: [.font: NSFont(name: "Apple Color Emoji", size: side * emojiShare)!])
  let bounds = text.size()
  text.draw(at: NSPoint(x: (side - bounds.width) / 2, y: (side - bounds.height) / 2))
  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "icons", code: 2) }
  try png.write(to: URL(fileURLWithPath: file))
  print(file, size)
}

let page = NSColor(srgbRed: 7 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1)
try draw(size: 512, emojiShare: 0.78, background: nil, to: "public/icon-512.png")
try draw(size: 192, emojiShare: 0.78, background: nil, to: "public/icon-192.png")
try draw(size: 180, emojiShare: 0.74, background: nil, to: "public/apple-touch-icon.png")
try draw(size: 512, emojiShare: 0.56, background: page, to: "public/icon-maskable-512.png")
