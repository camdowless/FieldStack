import { Business } from "@/data/mockBusinesses";
import { LeadScoreBadge } from "./LeadScoreBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Globe, AlertTriangle, Bookmark, BookmarkCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

interface LeadCardProps {
  business: Business;
  isSaved: boolean;
  onSave: () => void;
  index?: number;
}

export function LeadCard({ business, isSaved, onSave, index = 0 }: LeadCardProps) {
  const { analysis } = business;

  const flags: string[] = [];
  if (!analysis.hasWebsite) flags.push("No Website");
  if (analysis.hasWebsite && !analysis.mobileFriendly) flags.push("Not Mobile-Friendly");
  if (analysis.hasWebsite && !analysis.hasHttps) flags.push("No HTTPS");
  if (!analysis.hasOnlineAds) flags.push("No Ads");
  if (analysis.facebookAsWebsite) flags.push("FB as Website");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg card-glow hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge variant="secondary" className="text-xs shrink-0">{business.category}</Badge>
                <LeadScoreBadge score={business.leadScore} label={business.label} size="sm" />
              </div>
              <Link to={`/lead/${business.id}`}>
                <h3 className="font-semibold text-lg truncate hover:text-primary transition-colors">
                  {business.name}
                </h3>
              </Link>
              {(business.city || business.state) && (
                <div className="flex items-center gap-1 text-muted-foreground text-sm mt-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{[business.city, business.state].filter(Boolean).join(", ")}</span>
                </div>
              )}
              {business.googleRating > 0 && (
                <div className="flex items-center gap-1 text-muted-foreground text-sm mt-0.5">
                  <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
                  <span>{business.googleRating}</span>
                  <span className="opacity-50">({business.reviewCount} reviews)</span>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={(e) => { e.preventDefault(); onSave(); }}
            >
              {isSaved ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5" />}
            </Button>
          </div>

          {flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
              {flags.slice(0, 4).map((flag) => (
                <span key={flag} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive font-medium">
                  <AlertTriangle className="h-3 w-3" />
                  {flag}
                </span>
              ))}
              {flags.length > 4 && (
                <span className="text-xs text-muted-foreground">+{flags.length - 4} more</span>
              )}
            </div>
          )}

          {analysis.hasWebsite && analysis.websiteUrl && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
              <Globe className="h-3 w-3" />
              <span className="truncate">{analysis.websiteUrl}</span>
            </div>
          )}

          <Link to={`/lead/${business.id}`} className="mt-3 block">
            <Button variant="outline" size="sm" className="w-full">View Details</Button>
          </Link>
        </CardContent>
      </Card>
    </motion.div>
  );
}
