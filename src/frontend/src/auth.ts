import { useInternetIdentity } from "./hooks/useInternetIdentity";

export function useAuth() {
  const { login, clear, loginStatus, isInitializing } = useInternetIdentity();

  const isAuthenticated = loginStatus === "success";
  const isLoading = isInitializing || loginStatus === "logging-in";

  return {
    isAuthenticated,
    isLoading,
    login,
    logout: clear,
  };
}
