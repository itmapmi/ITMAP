import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn } from "@/lib/queryClient";
import { apiRequestJson } from "@/lib/queryClient";
import type { User, LoginUser, RegisterUser } from "@shared/schema";

/**
 * Shared authentication hook for both desktop and mobile interfaces
 * Handles user authentication state, login, registration, and logout
 */
export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    throwOnError: false,
    retryOnMount: false,
    refetchOnMount: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginUser) => {
      const response = await apiRequestJson('/auth/login', 'POST', credentials);
      return response;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: RegisterUser) => {
      const response = await apiRequestJson('/auth/register', 'POST', userData);
      return response;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequestJson('/auth/logout', 'POST');
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    isAdmin: user?.role === 'admin',
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    loginError: loginMutation.error?.message,
    registerError: registerMutation.error?.message,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };
}
