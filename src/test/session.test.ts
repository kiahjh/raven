import { describe, it, expect } from 'vitest';
import { getSessionId, parseSessionId } from '../utils/session';

describe('getSessionId', () => {
  it('should generate unique IDs for different projects', () => {
    const id1 = getSessionId('surface-1', '/path/to/project-a');
    const id2 = getSessionId('surface-1', '/path/to/project-b');
    
    expect(id1).not.toBe(id2);
  });

  it('should generate same ID for same project and surface', () => {
    const id1 = getSessionId('surface-1', '/path/to/project');
    const id2 = getSessionId('surface-1', '/path/to/project');
    
    expect(id1).toBe(id2);
  });

  it('should generate different IDs for different surfaces in same project', () => {
    const id1 = getSessionId('surface-1', '/path/to/project');
    const id2 = getSessionId('surface-2', '/path/to/project');
    
    expect(id1).not.toBe(id2);
  });

  it('should handle null project path', () => {
    const id = getSessionId('surface-1', null);
    
    expect(id).toBe('default:surface-1');
  });

  it('should use "default" prefix for null project', () => {
    const id1 = getSessionId('surface-1', null);
    const id2 = getSessionId('surface-2', null);
    
    expect(id1).toMatch(/^default:/);
    expect(id2).toMatch(/^default:/);
    expect(id1).not.toBe(id2);
  });

  it('should handle special characters in path', () => {
    const id = getSessionId('surface-1', '/path/with spaces/and-dashes');
    
    expect(id).toBeTruthy();
    expect(id).toContain(':surface-1');
  });

  it('should handle unicode in path', () => {
    const id = getSessionId('surface-1', '/path/to/projektor');
    
    expect(id).toBeTruthy();
    expect(id).toContain(':surface-1');
  });

  it('should handle very long paths', () => {
    const longPath = '/a'.repeat(1000);
    const id = getSessionId('surface-1', longPath);
    
    expect(id).toBeTruthy();
    expect(id).toContain(':surface-1');
  });

  it('should handle empty surface ID', () => {
    const id = getSessionId('', '/path');
    
    expect(id).toMatch(/^[^:]+:$/);
  });

  it('should make path URL-safe by replacing special base64 chars', () => {
    // Paths with characters that produce +, /, = in base64
    const id = getSessionId('surface-1', '/path/that/will/produce/special+chars');
    
    // Should not contain these characters
    expect(id).not.toMatch(/[+/=]/);
  });
});

describe('parseSessionId', () => {
  it('should parse a valid session ID', () => {
    const sessionId = getSessionId('surface-1', '/path/to/project');
    const parsed = parseSessionId(sessionId);
    
    expect(parsed).not.toBeNull();
    expect(parsed?.surfaceId).toBe('surface-1');
    // Note: projectPath might not exactly match due to base64 replacement
  });

  it('should parse a session ID with null project', () => {
    const sessionId = 'default:surface-1';
    const parsed = parseSessionId(sessionId);
    
    expect(parsed).not.toBeNull();
    expect(parsed?.surfaceId).toBe('surface-1');
    expect(parsed?.projectPath).toBeNull();
  });

  it('should return null for invalid session ID without colon', () => {
    const parsed = parseSessionId('invalid-no-colon');
    
    expect(parsed).toBeNull();
  });

  it('should return null for session ID with empty surface ID', () => {
    const parsed = parseSessionId('pathId:');
    
    expect(parsed).toBeNull();
  });

  it('should handle session ID with multiple colons', () => {
    const parsed = parseSessionId('path:surface:extra');
    
    expect(parsed).not.toBeNull();
    expect(parsed?.surfaceId).toBe('surface:extra');
  });
});

describe('session ID round-trip', () => {
  it('should preserve surface ID in round-trip', () => {
    const surfaceId = 'surface-123';
    const projectPath = '/path/to/project';
    
    const sessionId = getSessionId(surfaceId, projectPath);
    const parsed = parseSessionId(sessionId);
    
    expect(parsed?.surfaceId).toBe(surfaceId);
  });

  it('should preserve null project in round-trip', () => {
    const surfaceId = 'surface-1';
    
    const sessionId = getSessionId(surfaceId, null);
    const parsed = parseSessionId(sessionId);
    
    expect(parsed?.surfaceId).toBe(surfaceId);
    expect(parsed?.projectPath).toBeNull();
  });
});
