import { describe, it, expect } from 'vitest';
import { computePopupPosition, ComputePositionInput } from '../components/CursorPopup';

// Helper to create input with common defaults
// Simulates a 20px tall line element
function createInput(overrides: Partial<ComputePositionInput>): ComputePositionInput {
  return {
    anchorX: 500,
    anchorTop: 400,      // top of the line
    anchorBottom: 420,   // bottom of the line (20px line height)
    popupWidth: 200,
    popupHeight: 150,
    viewportWidth: 1200,
    viewportHeight: 800,
    preferredPlacement: "below",
    horizontalAlign: "left",
    margin: 8,
    gap: 4,
    ...overrides,
  };
}

describe('computePopupPosition', () => {
  describe('basic positioning', () => {
    it('positions popup below anchor with left alignment by default', () => {
      const result = computePopupPosition(createInput({}));
      
      expect(result.left).toBe(500); // anchorX
      expect(result.top).toBe(424); // anchorBottom + gap
      expect(result.bottom).toBeNull();
      expect(result.flippedVertically).toBe(false);
      expect(result.flippedHorizontally).toBe(false);
    });

    it('positions popup above anchor when preferredPlacement is above', () => {
      const result = computePopupPosition(createInput({
        preferredPlacement: "above",
      }));
      
      expect(result.top).toBeNull();
      // bottom = viewportHeight - anchorTop + gap = 800 - 400 + 4 = 404
      expect(result.bottom).toBe(404);
      expect(result.flippedVertically).toBe(false);
    });
  });

  describe('horizontal alignment', () => {
    it('centers popup when horizontalAlign is center', () => {
      const result = computePopupPosition(createInput({
        horizontalAlign: "center",
        popupWidth: 200,
        anchorX: 600,
      }));
      
      expect(result.left).toBe(500); // 600 - 200/2
    });

    it('right-aligns popup when horizontalAlign is right', () => {
      const result = computePopupPosition(createInput({
        horizontalAlign: "right",
        popupWidth: 200,
        anchorX: 600,
      }));
      
      expect(result.left).toBe(400); // 600 - 200
    });
  });

  describe('horizontal boundary detection', () => {
    it('prevents popup from going past left edge', () => {
      const result = computePopupPosition(createInput({
        anchorX: 5, // Too close to left edge
        popupWidth: 200,
        margin: 8,
      }));
      
      expect(result.left).toBe(8); // margin
      expect(result.flippedHorizontally).toBe(false); // left align doesn't flip
    });

    it('prevents popup from going past right edge', () => {
      const result = computePopupPosition(createInput({
        anchorX: 1100, // Too close to right edge
        popupWidth: 200,
        viewportWidth: 1200,
        margin: 8,
      }));
      
      expect(result.left).toBe(992); // 1200 - 8 - 200
      // For left-aligned popup clamped at right edge, not considered "flipped"
      expect(result.flippedHorizontally).toBe(false);
    });

    it('marks flippedHorizontally when center-aligned popup hits left edge', () => {
      const result = computePopupPosition(createInput({
        horizontalAlign: "center",
        anchorX: 50,
        popupWidth: 200,
        margin: 8,
      }));
      
      expect(result.left).toBe(8);
      expect(result.flippedHorizontally).toBe(true);
    });

    it('marks flippedHorizontally when center-aligned popup hits right edge', () => {
      const result = computePopupPosition(createInput({
        horizontalAlign: "center",
        anchorX: 1150,
        popupWidth: 200,
        viewportWidth: 1200,
        margin: 8,
      }));
      
      expect(result.left).toBe(992); // 1200 - 8 - 200
      expect(result.flippedHorizontally).toBe(true);
    });
  });

  describe('vertical boundary detection - flip from below to above', () => {
    it('flips to above when not enough space below and more space above', () => {
      const result = computePopupPosition(createInput({
        preferredPlacement: "below",
        anchorTop: 680,
        anchorBottom: 700, // Close to bottom
        popupHeight: 150,
        viewportHeight: 800,
        margin: 8,
      }));
      
      // Space below: 800 - 700 = 100, which is < 150 + 8
      // Space above: 680, which is > 100
      expect(result.top).toBeNull();
      expect(result.bottom).not.toBeNull();
      expect(result.flippedVertically).toBe(true);
    });

    it('does not flip when space below is sufficient', () => {
      const result = computePopupPosition(createInput({
        preferredPlacement: "below",
        anchorTop: 400,
        anchorBottom: 420,
        popupHeight: 150,
        viewportHeight: 800,
        margin: 8,
      }));
      
      // Space below: 800 - 420 = 380, which is > 150 + 8
      expect(result.top).not.toBeNull();
      expect(result.bottom).toBeNull();
      expect(result.flippedVertically).toBe(false);
    });
  });

  describe('vertical boundary detection - flip from above to below', () => {
    it('flips to below when not enough space above and more space below', () => {
      const result = computePopupPosition(createInput({
        preferredPlacement: "above",
        anchorTop: 100,
        anchorBottom: 120, // Close to top
        popupHeight: 150,
        viewportHeight: 800,
        margin: 8,
      }));
      
      // Space above: 100, which is < 150 + 8
      // Space below: 800 - 120 = 680, which is > 100
      expect(result.top).not.toBeNull();
      expect(result.bottom).toBeNull();
      expect(result.flippedVertically).toBe(true);
    });
  });

  describe('positioning precision', () => {
    it('positions popup exactly at anchorBottom + gap when below', () => {
      const result = computePopupPosition(createInput({
        preferredPlacement: "below",
        anchorBottom: 500,
        gap: 4,
      }));
      
      expect(result.top).toBe(504); // 500 + 4
    });

    it('positions popup so its bottom is at anchorTop - gap when above', () => {
      const result = computePopupPosition(createInput({
        preferredPlacement: "above",
        anchorTop: 300,
        viewportHeight: 800,
        gap: 4,
      }));
      
      // bottom CSS value = viewportHeight - anchorTop + gap = 800 - 300 + 4 = 504
      // This means popup bottom is at: viewportHeight - bottom = 800 - 504 = 296
      // Which is anchorTop - gap = 300 - 4 = 296 ✓
      expect(result.bottom).toBe(504);
    });
  });

  describe('real-world scenarios', () => {
    it('handles hover popup at bottom of editor', () => {
      // Simulating a hover popup at bottom of a 1080p screen
      const result = computePopupPosition({
        anchorX: 400,
        anchorTop: 930,
        anchorBottom: 950,
        popupWidth: 400,
        popupHeight: 350, // Hover popup max height
        viewportWidth: 1920,
        viewportHeight: 1080,
        preferredPlacement: "below",
        horizontalAlign: "left",
        margin: 8,
        gap: 4,
      });
      
      // Should flip to above since not enough space below (130px) vs above (930px)
      expect(result.flippedVertically).toBe(true);
      expect(result.bottom).not.toBeNull();
      expect(result.top).toBeNull();
    });

    it('handles completion menu at right edge', () => {
      // Simulating completion at far right of editor
      const result = computePopupPosition({
        anchorX: 1800,
        anchorTop: 380,
        anchorBottom: 400,
        popupWidth: 280, // Completion menu min width
        popupHeight: 200,
        viewportWidth: 1920,
        viewportHeight: 1080,
        preferredPlacement: "below",
        horizontalAlign: "left",
        margin: 8,
        gap: 4,
      });
      
      // Should be clamped to stay within viewport
      expect(result.left).toBe(1632); // 1920 - 8 - 280
    });

    it('handles code actions centered under cursor', () => {
      const result = computePopupPosition({
        anchorX: 600,
        anchorTop: 280,
        anchorBottom: 300,
        popupWidth: 320,
        popupHeight: 260,
        viewportWidth: 1920,
        viewportHeight: 1080,
        preferredPlacement: "below",
        horizontalAlign: "center",
        margin: 8,
        gap: 4,
      });
      
      expect(result.left).toBe(440); // 600 - 160
      expect(result.top).toBe(304); // 300 + 4
      expect(result.flippedVertically).toBe(false);
      expect(result.flippedHorizontally).toBe(false);
    });
  });
});
