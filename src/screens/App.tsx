import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import type { Theme } from "../hooks/useTheme";
import { useTheme } from "../hooks/useTheme";
import { BoardScreen } from "./BoardScreen";
import { LoginScreen } from "./LoginScreen";
import { ProjectsScreen } from "./ProjectsScreen";

export interface ScreenProps {
  theme: Theme;
  toggleTheme: () => void;
  onLogout: () => void;
  logoutPending: boolean;
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => taskaApi.logout(),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
  const screenProps = {
    theme,
    toggleTheme,
    onLogout: () => logout.mutate(),
    logoutPending: logout.isPending,
  };

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
