import { useState, useEffect, useCallback } from "react";
import { Business, LeadStatus } from "@/data/mockBusinesses";

export interface SavedLead {
  business: Business;
  status: LeadStatus;
  savedAt: string;
  notes: string;
  omitFromSearch: boolean;
  completedActions?: string[];
  customEmailScript?: string;
}

export interface SavedSearch {
  id: string;
  query: string;
  city: string;
  category: string;
  sortBy: string;
  resultIds: string[];
  resultCount: number;
  savedAt: string;
}

interface LeadStore {
  savedLeads: SavedLead[];
  searchHistory: string[];
  savedSearches: SavedSearch[];
  saveLead: (business: Business) => void;
  removeLead: (businessId: string) => void;
  updateStatus: (businessId: string, status: LeadStatus) => void;
  updateNotes: (businessId: string, notes: string) => void;
  toggleOmit: (businessId: string) => void;
  toggleActionComplete: (businessId: string, actionId: string) => void;
  updateEmailScript: (businessId: string, script: string) => void;
  getSavedLead: (businessId: string) => SavedLead | undefined;
  isLeadSaved: (businessId: string) => boolean;
  addSearchTerm: (term: string) => void;
  saveSearch: (search: Omit<SavedSearch, "id" | "savedAt">) => void;
  deleteSearch: (id: string) => void;
  clearAllSearches: () => void;
}

export function useLeadStore(): LeadStore {
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>(() => {
    const stored = localStorage.getItem("gimmeleads-saved");
    return stored ? JSON.parse(stored) : [];
  });

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    const stored = localStorage.getItem("gimmeleads-history");
    return stored ? JSON.parse(stored) : [];
  });

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => {
    const stored = localStorage.getItem("gimmeleads-searches");
    return stored ? JSON.parse(stored) : [];
  });

  useEffect(() => {
    localStorage.setItem("gimmeleads-saved", JSON.stringify(savedLeads));
  }, [savedLeads]);

  useEffect(() => {
    localStorage.setItem("gimmeleads-history", JSON.stringify(searchHistory));
  }, [searchHistory]);

  useEffect(() => {
    localStorage.setItem("gimmeleads-searches", JSON.stringify(savedSearches));
  }, [savedSearches]);

  const saveLead = useCallback((business: Business) => {
    setSavedLeads((prev) => {
      if (prev.find((l) => l.business.id === business.id)) return prev;
      return [...prev, { business, status: "saved", savedAt: new Date().toISOString(), notes: "", omitFromSearch: false }];
    });
  }, []);

  const removeLead = useCallback((businessId: string) => {
    setSavedLeads((prev) => prev.filter((l) => l.business.id !== businessId));
  }, []);

  const updateStatus = useCallback((businessId: string, status: LeadStatus) => {
    setSavedLeads((prev) => prev.map((l) => (l.business.id === businessId ? { ...l, status } : l)));
  }, []);

  const updateNotes = useCallback((businessId: string, notes: string) => {
    setSavedLeads((prev) => prev.map((l) => (l.business.id === businessId ? { ...l, notes } : l)));
  }, []);

  const toggleOmit = useCallback((businessId: string) => {
    setSavedLeads((prev) => prev.map((l) => (l.business.id === businessId ? { ...l, omitFromSearch: !l.omitFromSearch } : l)));
  }, []);

  const toggleActionComplete = useCallback((businessId: string, actionId: string) => {
    setSavedLeads((prev) => prev.map((l) => {
      if (l.business.id !== businessId) return l;
      const current = l.completedActions ?? [];
      const next = current.includes(actionId) ? current.filter((a) => a !== actionId) : [...current, actionId];
      return { ...l, completedActions: next };
    }));
  }, []);

  const updateEmailScript = useCallback((businessId: string, script: string) => {
    setSavedLeads((prev) => prev.map((l) => (l.business.id === businessId ? { ...l, customEmailScript: script } : l)));
  }, []);

  const getSavedLead = useCallback((businessId: string) => savedLeads.find((l) => l.business.id === businessId), [savedLeads]);

  const isLeadSaved = useCallback((businessId: string) => savedLeads.some((l) => l.business.id === businessId), [savedLeads]);

  const addSearchTerm = useCallback((term: string) => {
    setSearchHistory((prev) => {
      const filtered = prev.filter((t) => t !== term);
      return [term, ...filtered].slice(0, 20);
    });
  }, []);

  const saveSearch = useCallback((search: Omit<SavedSearch, "id" | "savedAt">) => {
    setSavedSearches((prev) => {
      // Deduplicate: if most recent has same query+city+category, update it
      if (prev.length > 0) {
        const latest = prev[0];
        if (latest.query === search.query && latest.city === search.city && latest.category === search.category) {
          return [{ ...latest, sortBy: search.sortBy, resultIds: search.resultIds, resultCount: search.resultCount, savedAt: new Date().toISOString() }, ...prev.slice(1)];
        }
      }
      // Skip empty searches
      if (!search.query && search.city === "all" && search.category === "all") return prev;
      const newEntry: SavedSearch = {
        ...search,
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
      };
      return [newEntry, ...prev].slice(0, 50);
    });
  }, []);

  const deleteSearch = useCallback((id: string) => {
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearAllSearches = useCallback(() => {
    setSavedSearches([]);
  }, []);

  return { savedLeads, searchHistory, savedSearches, saveLead, removeLead, updateStatus, updateNotes, toggleOmit, toggleActionComplete, updateEmailScript, getSavedLead, isLeadSaved, addSearchTerm, saveSearch, deleteSearch, clearAllSearches };
}
