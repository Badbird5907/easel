// Stylesheets are compiled by NativeWind's Metro transformer.
declare module '*.css';

// NativeWind ships an empty declaration for its Tailwind preset.
declare module 'nativewind/preset' {
  const preset: import('tailwindcss').Config;
  export default preset;
}
