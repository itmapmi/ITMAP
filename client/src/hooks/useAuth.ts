import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn } from "@/lib/queryClient";
import { apiRequestJson } from "@/lib/queryClient";
import type { User, LoginUser, RegisterUser } from "@shared/schema";
import { hasFeatureAccess, type LockableFeatureKey } from "@shared/features";
import { getRedditClickId, getRedditUuid, trackRedditSignUp } from "@/lib/reddit-pixel";

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
      // Forward Reddit Ads match keys (if present) so the server can pair
      // this signup with a Conversions API event for the same conversion.
      const redditClickId = getRedditClickId();
      const redditUuid = getRedditUuid();
      const response = await apiRequestJson('/auth/register', 'POST', {
        ...userData,
        ...(redditClickId ? { redditClickId } : {}),
        ...(redditUuid ? { redditUuid } : {}),
      });
      return response;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Same conversionId the server sends with its Conversions API SignUp
      // event (the user's own id) — Reddit's documented way to tie a Pixel
      // event and a CAPI event to the same conversion.
      trackRedditSignUp((user as { id?: string })?.id ?? null);
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

  const isVendorScoped = !!(user?.vendorScopeId || (user as any)?.vendorScopeIds?.length);
  const isVendorPersona = (user as any)?.persona === "vendor";

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    isAdmin: user?.role === 'admin',
    isBuyer: !!user && !isVendorScoped && !isVendorPersona && user.role !== 'admin',
    vendorScopeId: user?.vendorScopeId ?? null,
    isVendorScoped,
    isVendorPersona,
    // Buyers get all features unlocked; vendor users (scoped or persona) are gated
    hasFeature: (featureKey: LockableFeatureKey) =>
      hasFeatureAccess(user?.role, user?.featureAccess, featureKey, isVendorScoped, isVendorPersona),
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    loginError: loginMutation.error?.message,
    registerError: registerMutation.error?.message,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };
}