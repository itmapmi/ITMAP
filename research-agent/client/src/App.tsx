import { Router, Route, Switch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectSetupPage from "./pages/ProjectSetupPage";
import Phase1DashboardPage from "./pages/Phase1DashboardPage";
import Phase2ReviewPage from "./pages/Phase2ReviewPage";
import { Toaster } from "./components/ui/toaster";

function App() {
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Router>
        <Switch>
          <Route path="/register" component={RegisterPage} />
          <Route component={LoginPage} />
        </Switch>
        <Toaster />
      </Router>
    );
  }

  return (
    <Router>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/projects/new" component={ProjectSetupPage} />
        <Route path="/projects/:id" component={ProjectSetupPage} />
        <Route path="/projects/:id/phase1" component={Phase1DashboardPage} />
        <Route path="/projects/:id/phase2" component={Phase2ReviewPage} />
      </Switch>
      <Toaster />
    </Router>
  );
}

export default App;
