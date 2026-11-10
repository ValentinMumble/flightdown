// Lifts the subject out of a photo with Apple's Vision framework (what Photos' "lift subject" uses), and writes it as
// a PNG with a transparent background, cropped to the subject and at most LONGEST pixels on its long side.
// Usage: swift scripts/cutout/lift.swift <photo> <out.png>
import AppKit
import CoreImage
import Vision

let longest: CGFloat = 900
let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write("Usage: lift.swift <photo> <out.png>\n".data(using: .utf8)!)
  exit(2)
}
let input = URL(fileURLWithPath: arguments[1])
let output = URL(fileURLWithPath: arguments[2])

guard let source = CIImage(contentsOf: input) else {
  FileHandle.standardError.write("Cannot read \(input.path)\n".data(using: .utf8)!)
  exit(1)
}
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: source)
try handler.perform([request])
guard let result = request.results?.first, !result.allInstances.isEmpty else {
  FileHandle.standardError.write("No subject found in \(input.path)\n".data(using: .utf8)!)
  exit(3)
}
let buffer = try result.generateMaskedImage(
  ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
var lifted = CIImage(cvPixelBuffer: buffer)
let scale = min(1, longest / max(lifted.extent.width, lifted.extent.height))
if scale < 1 {
  lifted = lifted.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
}
let context = CIContext()
guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { exit(1) }
try context.writePNGRepresentation(of: lifted, to: output, format: .RGBA8, colorSpace: colorSpace)
print("\(Int(lifted.extent.width))x\(Int(lifted.extent.height))")
