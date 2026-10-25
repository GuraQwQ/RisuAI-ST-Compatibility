export const isCompatibilityStreaming = ({ enabled, role, streaming, index, length }) =>
  enabled && role === 'char' && streaming && index === length - 1;
