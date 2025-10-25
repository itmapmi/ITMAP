import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { NewPlayer } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface NewPlayersProps {
  marketId: string;
}

export function NewPlayers({ marketId }: NewPlayersProps) {
  const { data: players, isLoading } = useQuery<NewPlayer[]>({
    queryKey: ["/api/markets", marketId, "new-players"],
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <div className="text-muted-foreground">Loading new players...</div>
      </div>
    );
  }

  if (!players || players.length === 0) {
    return (
      <div className="flex justify-center items-center p-12">
        <div className="text-center">
          <p className="text-lg text-muted-foreground mb-2">No New Players Yet</p>
          <p className="text-sm text-muted-foreground">
            Check back later for emerging vendors in this market.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">New Players</h3>
        <p className="text-muted-foreground">
          Emerging vendors and new entrants in this market space
        </p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Vendor Name</TableHead>
              <TableHead className="w-[200px]">Website</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[150px]">Est. Revenue</TableHead>
              <TableHead className="w-[150px]">Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.map((player) => (
              <TableRow key={player.id} data-testid={`row-player-${player.id}`}>
                <TableCell className="font-semibold" data-testid={`text-name-${player.id}`}>
                  {player.name}
                </TableCell>
                <TableCell data-testid={`link-website-${player.id}`}>
                  {player.websiteUrl ? (
                    <a
                      href={player.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      Visit Site
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell data-testid={`text-description-${player.id}`}>
                  {player.description || <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell data-testid={`text-revenue-${player.id}`}>
                  {player.estimatedRevenue || <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell data-testid={`text-location-${player.id}`}>
                  {player.location || <span className="text-muted-foreground">-</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
