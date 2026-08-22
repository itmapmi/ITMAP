import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { Building2, Clock, Mail, MailOpen, Search, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface AdminContactMessage {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  subject: string;
  message: string;
  source: "contact_page" | "vendor_page";
  vendorId: string | null;
  vendorName: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

function sourceLabel(source: AdminContactMessage["source"]): string {
  return source === "vendor_page" ? "Vendor Contact Sales" : "Contact page";
}

export function ContactMessagesAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const { data: messages = [], isLoading, isError } = useQuery<AdminContactMessage[]>({
    queryKey: ["/api/admin/contact-messages"],
    refetchInterval: 60000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      apiRequestJson(`/api/admin/contact-messages/${id}/read`, "PATCH", { isRead }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contact-messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contact-messages/unread-count"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update message",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter((message) =>
      [
        message.firstName,
        message.lastName,
        message.email,
        message.company,
        message.subject,
        message.message,
        message.vendorName ?? "",
        sourceLabel(message.source),
      ].some((value) => value.toLowerCase().includes(term)),
    );
  }, [messages, search]);

  const unread = messages.filter((message) => !message.isRead).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Messages ({messages.length})
              {unread > 0 && <Badge variant="destructive">{unread} unread</Badge>}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Enquiries submitted through the contact and vendor sales forms.
            </p>
          </div>
          <div className="relative sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search messages"
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Messages could not be loaded. Please try again.</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Mail className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              {search ? "No messages match your search." : "No contact messages yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((message) => (
              <article
                key={message.id}
                className={`rounded-lg border p-4 transition-colors ${
                  message.isRead ? "bg-white border-gray-200" : "bg-blue-50/60 border-blue-200"
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {!message.isRead && <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />}
                      <h3 className="font-semibold text-gray-900">{message.subject}</h3>
                      <Badge variant="outline">{sourceLabel(message.source)}</Badge>
                      {message.vendorName && <Badge variant="secondary">{message.vendorName}</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground mb-3">
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {message.firstName} {message.lastName}
                      </span>
                      <a className="inline-flex items-center gap-1 hover:text-blue-600" href={`mailto:${message.email}`}>
                        <Mail className="h-3.5 w-3.5" />
                        {message.email}
                      </a>
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {message.company}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(message.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{message.message}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: message.id, isRead: !message.isRead })}
                  >
                    {message.isRead ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
                    Mark {message.isRead ? "unread" : "read"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}