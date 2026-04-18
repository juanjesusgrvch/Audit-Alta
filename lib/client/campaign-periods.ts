"use client";

import { useEffect, useState } from "react";
import { fetchWithFirebaseAuth } from "@/lib/client/auth-fetch";

export type CampaignPeriod = {
  id: string;
  nombre: string;
  fechaDesde: string;
  fechaHasta: string;
  predeterminada: boolean;
};

type CampaignPayload = {
  campanias: CampaignPeriod[];
};

type CampaignCacheEntry = {
  data: CampaignPeriod[] | null;
  error: string | null;
  promise: Promise<void> | null;
  status: "idle" | "loading" | "ready" | "error";
};

const campaignCache: CampaignCacheEntry = {
  data: null,
  error: null,
  promise: null,
  status: "idle"
};

const listeners = new Set<() => void>();

function emitCampaignUpdate() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribeCampaigns(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

async function loadCampaigns(force = false) {
  if (campaignCache.promise && !force) {
    return campaignCache.promise;
  }

  if (campaignCache.status === "ready" && campaignCache.data && !force) {
    return Promise.resolve();
  }

  campaignCache.status = "loading";
  campaignCache.error = null;
  emitCampaignUpdate();

  const promise = fetchWithFirebaseAuth("/api/campanias", {
    method: "GET",
    cache: "no-store"
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("No fue posible cargar las campañas.");
      }

      const payload = (await response.json()) as CampaignPayload;
      campaignCache.data = payload.campanias ?? [];
      campaignCache.status = "ready";
      campaignCache.error = null;
    })
    .catch((error) => {
      campaignCache.status = "error";
      campaignCache.error =
        error instanceof Error
          ? error.message
          : "No fue posible cargar las campañas.";
    })
    .finally(() => {
      campaignCache.promise = null;
      emitCampaignUpdate();
    });

  campaignCache.promise = promise;
  return promise;
}

export function refreshCampaignPeriods() {
  return loadCampaigns(true);
}

export function getDefaultCampaignId(campaigns: CampaignPeriod[]) {
  return campaigns.find((campaign) => campaign.predeterminada)?.id ?? null;
}

export function useCampaignPeriods() {
  const [snapshot, setSnapshot] = useState({
    campaigns: campaignCache.data ?? [],
    error: campaignCache.error,
    isLoading: campaignCache.status === "loading"
  });

  useEffect(() => {
    const unsubscribe = subscribeCampaigns(() => {
      setSnapshot({
        campaigns: campaignCache.data ?? [],
        error: campaignCache.error,
        isLoading: campaignCache.status === "loading"
      });
    });

    void loadCampaigns();
    return unsubscribe;
  }, []);

  return {
    campaigns: snapshot.campaigns,
    error: snapshot.error,
    isLoading: snapshot.isLoading,
    refresh: refreshCampaignPeriods
  };
}

export function resolveCampaignPeriod(
  campaigns: CampaignPeriod[],
  selectedCampaignId: string
) {
  if (selectedCampaignId === "all") {
    return null;
  }

  return campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
}

export function mergeCampaignDateRange(
  selectedCampaign: CampaignPeriod | null,
  from: string,
  to: string
) {
  if (!selectedCampaign) {
    return {
      from,
      to
    };
  }

  return {
    from:
      from && from > selectedCampaign.fechaDesde
        ? from
        : selectedCampaign.fechaDesde,
    to:
      to && to < selectedCampaign.fechaHasta ? to : selectedCampaign.fechaHasta
  };
}

export function matchesCampaignDateKey(
  dateKey: string,
  selectedCampaign: CampaignPeriod | null
) {
  if (!selectedCampaign) {
    return true;
  }

  return Boolean(
    dateKey &&
      dateKey >= selectedCampaign.fechaDesde &&
      dateKey <= selectedCampaign.fechaHasta
  );
}
