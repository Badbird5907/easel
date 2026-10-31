/*
 * Props for Easel's home screen widgets (SYS-1). Widgets render in an isolated
 * runtime that sees only these props, so everything they show, including
 * colors for both schemes and the links they open, travels in here as JSON.
 */

/** Easel's colors for one scheme, picked from the design tokens. */
export type WidgetPalette = {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  subtle: string;
  border: string;
  accent: string;
  accentFg: string;
  danger: string;
  dangerFg: string;
};

/** Both schemes: the widget picks one from `environment.colorScheme`. */
export type WidgetTheme = { light: WidgetPalette; dark: WidgetPalette };

/** A course color with its dark-mode variant. */
export type WidgetColor = { light: string; dark: string };

export type WidgetRow = {
  id: string;
  title: string;
  /** Course code, or the context Canvas named. */
  context: string;
  color: WidgetColor;
  /** Right-hand text: a time, an age, or a grade. */
  detail: string;
  /** Marks the row: missing work, an unread announcement. */
  flag: 'missing' | 'unread' | null;
  /** `easel://` link the row opens. */
  url: string;
};

/**
 * `ready` shows data. `signedOut` and `off` show `message` (sign in, or turn
 * Grades on). `waiting` is before the app has published anything.
 */
export type WidgetState = 'ready' | 'signedOut' | 'off' | 'waiting';

export type NextDueProps = {
  state: WidgetState;
  theme: WidgetTheme;
  /** What a tap anywhere opens. */
  url: string;
  /** "Due in 5 hours", or "Nothing due this week". */
  headline: string;
  title: string | null;
  context: string | null;
  color: WidgetColor | null;
  /** "2 missing · 3 more this week". */
  summary: string | null;
  /** One line for the Lock Screen: "MATH 241 due in 5 hours". */
  inline: string;
  /** What comes after the next deadline, for the medium size. */
  rows: WidgetRow[];
  message: string;
};

/** To Do, Announcements, and Grades share one list layout. */
export type ListWidgetProps = {
  state: WidgetState;
  theme: WidgetTheme;
  url: string;
  title: string;
  /** Under the title: "3 due today", "2 unread". */
  summary: string;
  rows: WidgetRow[];
  /** Shown when `rows` is empty. */
  empty: string;
  message: string;
};
