import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: { DEFAULT: "#7FD8BE" },
        coral: { DEFAULT: "#E8927C" },
      },
      backdropBlur: { md: "12px" },
    },
  },
  plugins: [],
};

export default config;
