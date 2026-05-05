export const colors = {
  // Brand
  red: '#C8332D',
  navy: '#1F3D5C',
  teal: '#2A9DA6',

  // Neutrals
  white: '#FFFFFF',
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',

  // Semantic
  background: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  textMuted: '#64748B',
  textInverse: '#FFFFFF',
  border: '#E2E8F0',
  primary: '#1F3D5C',
  primaryText: '#FFFFFF',
  danger: '#C8332D',
  success: '#16A34A',
} as const;

export type ColorToken = keyof typeof colors;
