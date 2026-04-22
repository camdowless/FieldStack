import React, { createContext, useContext, useState, useEffect } from "react";

type ThemeMode = "light" | "gradient";

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: "light", toggleTheme: () => {} });

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem("cozyleads-theme") as ThemeMode) || "light";
  });

  useEffect(() => {
    localStorage.setItem("cozyleads-theme", theme);
    document.documentElement.classList.remove("theme-light", "theme-gradient");
    document.documentElement.classList.add(`theme-${theme}`);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "light" ? "gradient" : "light"));

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};
