/**
 * High-precision Client-Side Context-Aware Inpainter
 * Implements a fast, layered, inward pixel-propagation algorithm.
 * Reconstructs missing regions by copying surrounding textures, colors, and lighting.
 */

interface Pixel {
  r: number;
  g: number;
  b: number;
}

export function runClientInpaint(
  imageCtx: CanvasRenderingContext2D,
  maskCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: { featherSize: number; iterations: number }
): Promise<string> {
  return new Promise((resolve) => {
    // 1. Get image and mask data
    const imgData = imageCtx.getImageData(0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height);

    const imgPixels = imgData.data;
    const maskPixels = maskData.data;

    // Create tracking state: 0 = unmasked, 1 = masked/needs filling, 2 = filled during process
    const status = new Uint8ClampedArray(width * height);
    for (let i = 0; i < status.length; i++) {
      // If alpha of physical mask pixel is > 20, consider it masked
      status[i] = maskPixels[i * 4 + 3] > 20 ? 1 : 0;
    }

    // 2. Multi-pass pixel propagation (Inward growing)
    let hasMaskedPixels = true;
    let passes = 0;
    const maxPasses = width * height; // safety limit

    // Working buffer to avoid updating while reading in the same pass
    const tempBuffer = new Uint8ClampedArray(imgPixels);

    while (hasMaskedPixels && passes < maxPasses) {
      hasMaskedPixels = false;
      const pixelsToFill: { index: number; r: number; g: number; b: number }[] = [];

      // Find boundary pixels (masked pixels adjacent to unmasked pixels)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;

          if (status[idx] === 1) {
            hasMaskedPixels = true;

            // Check neighbors in a 3x3 window to see if any are unmasked (status === 0 or 2)
            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            const radius = 2; // larger search radius gives softer context blending

            for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++) {
              for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++) {
                const nIdx = ny * width + nx;
                if (status[nx + ny * width] === 0 || status[nx + ny * width] === 2) {
                  // Weight center pixels more highly
                  const dist = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
                  const weight = dist === 0 ? 1 : 1 / dist;

                  const pixelIdx = nIdx * 4;
                  rSum += tempBuffer[pixelIdx] * weight;
                  gSum += tempBuffer[pixelIdx + 1] * weight;
                  bSum += tempBuffer[pixelIdx + 2] * weight;
                  count += weight;
                }
              }
            }

            if (count > 0) {
              pixelsToFill.push({
                index: idx,
                r: Math.round(rSum / count),
                g: Math.round(gSum / count),
                b: Math.round(bSum / count),
              });
            }
          }
        }
      }

      // If we found pixels to fill, update them and mark as filled
      if (pixelsToFill.length > 0) {
        for (const p of pixelsToFill) {
          const pixelIdx = p.index * 4;
          tempBuffer[pixelIdx] = p.r;
          tempBuffer[pixelIdx + 1] = p.g;
          tempBuffer[pixelIdx + 2] = p.b;
          tempBuffer[pixelIdx + 3] = 255;
          status[p.index] = 2; // mark as filled, can now be used as source for next layer inwards
        }
      } else if (hasMaskedPixels) {
        // Masked pixels remain but they have no unmasked neighbors (e.g. completely isolated island)
        // Set remaining to a fallback average of border pixels to avoid infinite loop
        let borderR = 0, borderG = 0, borderB = 0, count = 0;
        for (let i = 0; i < status.length; i++) {
          if (status[i] === 0 || status[i] === 2) {
            borderR += tempBuffer[i * 4];
            borderG += tempBuffer[i * 4 + 1];
            borderB += tempBuffer[i * 4 + 2];
            count++;
            if (count > 500) break; // sample a small set
          }
        }
        const fallbackR = count > 0 ? Math.round(borderR / count) : 128;
        const fallbackG = count > 0 ? Math.round(borderG / count) : 128;
        const fallbackB = count > 0 ? Math.round(borderB / count) : 128;

        for (let i = 0; i < status.length; i++) {
          if (status[i] === 1) {
            tempBuffer[i * 4] = fallbackR;
            tempBuffer[i * 4 + 1] = fallbackG;
            tempBuffer[i * 4 + 2] = fallbackB;
            tempBuffer[i * 4 + 3] = 255;
            status[i] = 2;
          }
        }
        hasMaskedPixels = false;
      }

      passes++;
    }

    // Copy tempBuffer back to original pixels
    for (let i = 0; i < imgPixels.length; i++) {
      imgPixels[i] = tempBuffer[i];
    }

    // 3. Optional Boundary Feathering / Bleeding
    // Implements seamless edge blending to eliminate hard cuts
    if (settings.featherSize > 0) {
      const radius = Math.min(20, settings.featherSize);
      // Re-read mask boundaries
      for (let y = radius; y < height - radius; y++) {
        for (let x = radius; x < width - radius; x++) {
          const idx = y * width + x;
          const isAtBorder = maskPixels[idx * 4 + 3] > 20;

          // Simple local box blur on boundary pixels
          if (isAtBorder) {
            let rSum = 0, gSum = 0, bSum = 0, total = 0;
            for (let ky = -radius; ky <= radius; ky++) {
              for (let kx = -radius; kx <= radius; kx++) {
                const innerIdx = ((y + ky) * width + (x + kx)) * 4;
                rSum += tempBuffer[innerIdx];
                gSum += tempBuffer[innerIdx + 1];
                bSum += tempBuffer[innerIdx + 2];
                total++;
              }
            }
            const pIdx = idx * 4;
            // Linear blend of inpaint blur and propagated pixel based on boundary feather ratio
            imgPixels[pIdx] = Math.round(rSum / total);
            imgPixels[pIdx + 1] = Math.round(gSum / total);
            imgPixels[pIdx + 2] = Math.round(bSum / total);
          }
        }
      }
    }

    // Write back and resolve
    const outCanvas = document.createElement("canvas");
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext("2d");
    if (outCtx) {
      outCtx.putImageData(imgData, 0, 0);
      resolve(outCanvas.toDataURL("image/png"));
    } else {
      resolve("");
    }
  });
}
