/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Kantumruy Pro', 'sans-serif'],
      },
      colors: {
        'brand': {
          'navy': '#13284c',
          'cyan': '#3db5e6',
          'orange': '#f98e2b',
          'green': '#76bd22',
          'red': '#ff4539',
          'yellow': '#ffc600',
          'purple': '#b981d1',
          'pink': '#fa7fb6',
          'brown': '#c78c67'
        },
        blue: {
          50: '#eef9fe',
          100: '#d8f0fd',
          200: '#bde7fc',
          300: '#91d8fa',
          400: '#5ec4f6',
          500: '#3db5e6',
          600: '#3db5e6', 
          700: '#2696cc',
          800: '#1f78a7',
          900: '#195372',
          950: '#11354c'
        },
        'brand-dark': '#13284c'
      },
      borderRadius: {
        'none': '0',
        'sm': '0',
        'DEFAULT': '0',
        'md': '0',
        'lg': '0',
        'xl': '0',
        '2xl': '0',
        '3xl': '0',
        'full': '0',
      }
    },
  },
  plugins: [],
}
