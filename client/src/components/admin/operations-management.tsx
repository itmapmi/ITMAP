import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import type { UserActivityLog } from "@shared/schema";

export default function OperationsManagement() {
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data, isLoading, refetch } = useQuery<{
    logs: UserActivityLog[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ['/api/admin/operations/user-logs', { page, limit, startDate, endDate }],
  });

  const handleFilter = () => {
    setPage(1);
    refetch();
  };

  const handleClearFilters = () => {
    setStartDate("");
    setEndDate("");
    setPage(1);
    refetch();
  };

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return "N/A";
    try {
      return format(new Date(date), "MMM dd, yyyy HH:mm:ss");
    } catch {
      return "Invalid date";
    }
  };

  const formatDuration = (loginAt: Date | string, logoutAt: Date | string | null) => {
    if (!logoutAt) return "Active session";
    try {
      const start = new Date(loginAt);
      const end = new Date(logoutAt);
      const durationMs = end.getTime() - start.getTime();
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${minutes}m`;
    } catch {
      return "N/A";
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Operations Management</h3>
        <p className="text-gray-600">Monitor user activity and system operations</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Activity Logs</CardTitle>
          <CardDescription>
            View and analyze user login/logout activity. Logs are automatically retained for 6 months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <div className="relative">
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-start-date"
                  />
                  <Calendar className="absolute right-3 top-2.5 h-5 w-5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <div className="relative">
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-end-date"
                  />
                  <Calendar className="absolute right-3 top-2.5 h-5 w-5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="flex items-end gap-2">
                <Button 
                  onClick={handleFilter}
                  data-testid="button-apply-filter"
                >
                  Apply Filter
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleClearFilters}
                  data-testid="button-clear-filters"
                >
                  Clear
                </Button>
              </div>
            </div>

            {/* Stats */}
            {data && (
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>Total Records: {data.total}</span>
                <span>
                  Page {page} of {totalPages}
                </span>
              </div>
            )}

            {/* Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Session ID</TableHead>
                    <TableHead>Login Time</TableHead>
                    <TableHead>Logout Time</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        Loading user activity logs...
                      </TableCell>
                    </TableRow>
                  ) : !data || data.logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        No user activity logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.logs.map((log) => (
                      <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                        <TableCell className="font-mono text-xs">
                          {log.userId.substring(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.sessionId ? log.sessionId.substring(0, 12) + '...' : 'N/A'}
                        </TableCell>
                        <TableCell>{formatDateTime(log.loginAt)}</TableCell>
                        <TableCell>{formatDateTime(log.logoutAt)}</TableCell>
                        <TableCell>{formatDateTime(log.lastSeenAt)}</TableCell>
                        <TableCell>{formatDuration(log.loginAt, log.logoutAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{log.ipAddress}</TableCell>
                        <TableCell>
                          {log.logoutAt ? (
                            <Badge variant="secondary" data-testid={`status-logged-out-${log.id}`}>
                              Logged Out
                            </Badge>
                          ) : (
                            <Badge variant="default" data-testid={`status-active-${log.id}`}>
                              Active
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {data && data.logs.length > 0 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  data-testid="button-prev-page"
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Showing {(page - 1) * limit + 1} to {Math.min(page * limit, data.total)} of{" "}
                  {data.total}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-next-page"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
