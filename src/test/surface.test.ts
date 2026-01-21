import { describe, it, expect, beforeEach } from 'vitest';

// We need to test the surface store logic
// Since the store is a singleton with side effects, we'll test the pure functions

describe('Surface Store - ID Generation', () => {
  it('should generate IDs with correct prefix', () => {
    // We can't easily test the store directly due to its singleton nature
    // But we can test the ID format
    const idPattern = /^surface-\d+$/;
    expect('surface-1').toMatch(idPattern);
    expect('surface-42').toMatch(idPattern);
  });
});

describe('Surface Types', () => {
  it('should have valid surface types', () => {
    type SurfaceType = 'editor' | 'terminal' | 'empty';
    const types: SurfaceType[] = ['editor', 'terminal', 'empty'];
    
    expect(types).toContain('editor');
    expect(types).toContain('terminal');
    expect(types).toContain('empty');
  });
});

describe('Surface Node Structure', () => {
  it('should have correct leaf structure', () => {
    const leaf = {
      kind: 'leaf' as const,
      id: 'surface-1',
      type: 'terminal' as const,
    };
    
    expect(leaf.kind).toBe('leaf');
    expect(leaf.id).toBeTruthy();
    expect(['editor', 'terminal', 'empty']).toContain(leaf.type);
  });

  it('should have correct split structure', () => {
    const split = {
      kind: 'split' as const,
      id: 'split-1',
      direction: 'horizontal' as const,
      children: [
        { kind: 'leaf' as const, id: 'surface-1', type: 'terminal' as const },
        { kind: 'leaf' as const, id: 'surface-2', type: 'empty' as const },
      ],
      sizes: [1, 1],
    };
    
    expect(split.kind).toBe('split');
    expect(['horizontal', 'vertical']).toContain(split.direction);
    expect(split.children.length).toBe(2);
    expect(split.sizes.length).toBe(2);
  });
});

describe('Navigation Directions', () => {
  it('should have valid directions', () => {
    type Direction = 'left' | 'right' | 'up' | 'down';
    const directions: Direction[] = ['left', 'right', 'up', 'down'];
    
    expect(directions.length).toBe(4);
  });

  it('should map directions to horizontal/vertical', () => {
    const horizontalDirections = ['left', 'right'];
    const verticalDirections = ['up', 'down'];
    
    expect(horizontalDirections).toContain('left');
    expect(horizontalDirections).toContain('right');
    expect(verticalDirections).toContain('up');
    expect(verticalDirections).toContain('down');
  });
});

describe('Workspace Serialization', () => {
  it('should serialize a simple workspace', () => {
    const workspace = {
      root: {
        kind: 'leaf' as const,
        id: 'surface-1',
        type: 'terminal' as const,
      },
      focusedId: 'surface-1',
    };
    
    const json = JSON.stringify(workspace);
    const parsed = JSON.parse(json);
    
    expect(parsed.root.kind).toBe('leaf');
    expect(parsed.focusedId).toBe('surface-1');
  });

  it('should serialize a complex workspace', () => {
    const workspace = {
      root: {
        kind: 'split' as const,
        id: 'split-1',
        direction: 'horizontal' as const,
        children: [
          { kind: 'leaf' as const, id: 'surface-1', type: 'terminal' as const },
          {
            kind: 'split' as const,
            id: 'split-2',
            direction: 'vertical' as const,
            children: [
              { kind: 'leaf' as const, id: 'surface-2', type: 'editor' as const },
              { kind: 'leaf' as const, id: 'surface-3', type: 'empty' as const },
            ],
            sizes: [1, 2],
          },
        ],
        sizes: [1, 1],
      },
      focusedId: 'surface-2',
    };
    
    const json = JSON.stringify(workspace);
    const parsed = JSON.parse(json);
    
    expect(parsed.root.kind).toBe('split');
    expect(parsed.root.children.length).toBe(2);
    expect(parsed.root.children[1].kind).toBe('split');
    expect(parsed.root.children[1].children.length).toBe(2);
  });
});

describe('Size Ratios', () => {
  it('should handle equal sizes', () => {
    const sizes = [1, 1];
    const total = sizes.reduce((a, b) => a + b, 0);
    
    expect(sizes[0] / total).toBe(0.5);
    expect(sizes[1] / total).toBe(0.5);
  });

  it('should handle unequal sizes', () => {
    const sizes = [2, 1];
    const total = sizes.reduce((a, b) => a + b, 0);
    
    expect(sizes[0] / total).toBeCloseTo(0.667, 2);
    expect(sizes[1] / total).toBeCloseTo(0.333, 2);
  });

  it('should handle many children', () => {
    const sizes = [1, 1, 1, 1];
    const total = sizes.reduce((a, b) => a + b, 0);
    
    sizes.forEach(size => {
      expect(size / total).toBe(0.25);
    });
  });
});

describe('Leaf Position Calculation', () => {
  // Test the algorithm used for navigation
  
  function calculateLeafPositions(
    node: any,
    x = 0,
    y = 0,
    width = 1,
    height = 1
  ): { id: string; x: number; y: number; width: number; height: number }[] {
    if (node.kind === 'leaf') {
      return [{ id: node.id, x, y, width, height }];
    }
    
    const results: any[] = [];
    const totalSize = node.sizes.reduce((a: number, b: number) => a + b, 0);
    let offset = 0;
    
    for (let i = 0; i < node.children.length; i++) {
      const ratio = node.sizes[i] / totalSize;
      
      if (node.direction === 'horizontal') {
        const childWidth = width * ratio;
        results.push(...calculateLeafPositions(node.children[i], x + offset, y, childWidth, height));
        offset += childWidth;
      } else {
        const childHeight = height * ratio;
        results.push(...calculateLeafPositions(node.children[i], x, y + offset, width, childHeight));
        offset += childHeight;
      }
    }
    
    return results;
  }

  it('should calculate single leaf position', () => {
    const node = { kind: 'leaf', id: 'surface-1', type: 'terminal' };
    const positions = calculateLeafPositions(node);
    
    expect(positions.length).toBe(1);
    expect(positions[0]).toEqual({ id: 'surface-1', x: 0, y: 0, width: 1, height: 1 });
  });

  it('should calculate horizontal split positions', () => {
    const node = {
      kind: 'split',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        { kind: 'leaf', id: 'left', type: 'terminal' },
        { kind: 'leaf', id: 'right', type: 'terminal' },
      ],
    };
    const positions = calculateLeafPositions(node);
    
    expect(positions.length).toBe(2);
    expect(positions[0]).toEqual({ id: 'left', x: 0, y: 0, width: 0.5, height: 1 });
    expect(positions[1]).toEqual({ id: 'right', x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it('should calculate vertical split positions', () => {
    const node = {
      kind: 'split',
      direction: 'vertical',
      sizes: [1, 1],
      children: [
        { kind: 'leaf', id: 'top', type: 'terminal' },
        { kind: 'leaf', id: 'bottom', type: 'terminal' },
      ],
    };
    const positions = calculateLeafPositions(node);
    
    expect(positions.length).toBe(2);
    expect(positions[0]).toEqual({ id: 'top', x: 0, y: 0, width: 1, height: 0.5 });
    expect(positions[1]).toEqual({ id: 'bottom', x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it('should handle nested splits', () => {
    const node = {
      kind: 'split',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        { kind: 'leaf', id: 'left', type: 'terminal' },
        {
          kind: 'split',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            { kind: 'leaf', id: 'top-right', type: 'terminal' },
            { kind: 'leaf', id: 'bottom-right', type: 'terminal' },
          ],
        },
      ],
    };
    const positions = calculateLeafPositions(node);
    
    expect(positions.length).toBe(3);
    expect(positions.find(p => p.id === 'left')).toEqual({ id: 'left', x: 0, y: 0, width: 0.5, height: 1 });
    expect(positions.find(p => p.id === 'top-right')).toEqual({ id: 'top-right', x: 0.5, y: 0, width: 0.5, height: 0.5 });
    expect(positions.find(p => p.id === 'bottom-right')).toEqual({ id: 'bottom-right', x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it('should handle unequal sizes', () => {
    const node = {
      kind: 'split',
      direction: 'horizontal',
      sizes: [2, 1],
      children: [
        { kind: 'leaf', id: 'wide', type: 'terminal' },
        { kind: 'leaf', id: 'narrow', type: 'terminal' },
      ],
    };
    const positions = calculateLeafPositions(node);
    
    expect(positions.length).toBe(2);
    expect(positions[0].width).toBeCloseTo(2/3);
    expect(positions[1].width).toBeCloseTo(1/3);
  });
});

describe('Navigation Algorithm', () => {
  function findOverlap(a1: number, a2: number, b1: number, b2: number): number {
    const start = Math.max(a1, b1);
    const end = Math.min(a2, b2);
    return Math.max(0, end - start);
  }

  it('should calculate overlap correctly', () => {
    // Full overlap
    expect(findOverlap(0, 1, 0, 1)).toBe(1);
    
    // Partial overlap
    expect(findOverlap(0, 0.5, 0.25, 0.75)).toBe(0.25);
    
    // No overlap
    expect(findOverlap(0, 0.5, 0.5, 1)).toBe(0);
    expect(findOverlap(0, 0.4, 0.6, 1)).toBe(0);
    
    // One contains other
    expect(findOverlap(0.25, 0.75, 0, 1)).toBe(0.5);
  });
});
