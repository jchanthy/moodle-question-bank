/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        blue: {
          50: '#eef9fe',
          100: '#d8f0fd',
          200: '#bde7fc',
          300: '#91d8fa',
          400: '#5ec4f6',
          500: '#3db5e6',
          600: '#3db5e6', /* Mapped to 500 to ensure bg-blue-600 matches PrimeNG buttons */
          700: '#2696cc', /* Mapped to 600 for hover states */
          800: '#1f78a7',
          900: '#195372',
          950: '#11354c'
        },
        'brand-dark': '#13284c'
      }
    },
  },
  plugins: [],
}
