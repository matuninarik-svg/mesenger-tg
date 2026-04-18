/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2b5278',
          light: '#3a6b9e',
          dark: '#1f3d5a'
        },
        bg: {
          main: '#17212b',
          secondary: '#0e1621',
          chat: '#182533',
          message: '#2b5278'
        }
      }
    },
  },
  plugins: [],
}
