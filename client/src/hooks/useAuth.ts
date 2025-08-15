import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import type { User, LoginUser, RegisterUser } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginUser) => {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: credentials,
      });
      return response;
    },
    onSuccess: (user) => {
      setAuthChecked(false); // Allow refetch
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: RegisterUser) => {
      const response = await apiRequest('/auth/register', {
        method: 'POST',
        body: userData,
      });
      return response;
    },
    onSuccess: (user) => {
      setAuthChecked(false); // Allow refetch
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('/auth/logout', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      setAuthChecked(true); // Prevent refetch
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  return {
    user,
    isLoading: isLoading && !authChecked,
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