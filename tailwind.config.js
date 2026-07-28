/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          50: "#edfafa",
          100: "#d5f2f2",
          200: "#aae5e5",
          300: "#67d0d0",
          400: "#2bb8b8",
          500: "#069494",
          600: "#069494",
          700: "#057878",
          800: "#045f5f",
          900: "#033d3d",
        },
        brand: {
          orange: "#BE5103",
          rust:   "#B7410E",
          yellow: "#FFCE1B",
        },
      },
    },
  },
  plugins: [],
};
