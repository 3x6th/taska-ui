import { Navigate, Route, Routes } from "react-router-dom";
import type { Theme } from "../hooks/useTheme";
import { useTheme } from "../hooks/useTheme";
import { BoardScreen } from "./BoardScreen";
import { LoginScreen } from "./LoginScreen";
import { ProjectsScreen } from "./ProjectsScreen";

export interface ScreenProps {
  theme: Theme;
  toggleTheme: () => void;
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const screenProps = { theme, toggleTheme };

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginScreen {...screenProps} initialMode="signin" />} />
      <Route path="/invite" element={<LoginScreen {...screenProps} initialMode="invite" />} />
      <Route path="/projects" element={<ProjectsScreen {...screenProps} />} />
      <Route path="/projects/:projectId/board" element={<BoardScreen {...screenProps} />} />
      <Route path="/projects/:projectId/issues/:issueId" element={<BoardScreen {...screenProps} />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
