"use client";

import type { ReactNode } from "react";
import { CampaignSelectorCard } from "@/app/components/campaign-selector-card";
import { ModuleFiltersPanel } from "@/app/components/module-filters-panel";
import type { CampaignPeriod } from "@/lib/client/campaign-periods";

export function ModuleIntegratedFilters({
  campaignClassName = "xl:col-span-1",
  campaigns,
  children,
  clientLabel = "Cliente activo",
  currentClientLabel,
  filtersClassName,
  isOpen,
  onChangeCampaign,
  onClear,
  onNextClient,
  onPrevClient,
  onToggle,
  selectedCampaignId,
  subtitle,
  title
}: {
  campaignClassName?: string;
  campaigns: CampaignPeriod[];
  children: ReactNode;
  clientLabel?: string;
  currentClientLabel: string;
  filtersClassName: string;
  isOpen: boolean;
  onChangeCampaign: (value: string) => void;
  onClear: () => void;
  onNextClient: () => void;
  onPrevClient: () => void;
  onToggle: () => void;
  selectedCampaignId: string;
  subtitle?: string;
  title?: string;
}) {
  return (
    <ModuleFiltersPanel
      isOpen={isOpen}
      onClear={onClear}
      onToggle={onToggle}
      subtitle={subtitle}
      title={title}
    >
      <div className="grid gap-4 xl:grid-cols-8">
        <section className="aether-panel-soft flex min-h-[108px] flex-col justify-between rounded-lg px-4 py-4 xl:col-span-2">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {clientLabel}
          </p>
          <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2">
            <button
              className="console-secondary-button h-10 rounded-lg px-0 text-xs font-bold"
              onClick={onPrevClient}
              type="button"
            >
              {"<"}
            </button>
            <div className="flex h-10 items-center justify-center rounded-lg bg-[var(--surface-high)] px-3 text-center ring-1 ring-[var(--line)]">
              <span className="truncate text-sm font-bold text-[var(--text)]">
                {currentClientLabel}
              </span>
            </div>
            <button
              className="console-secondary-button h-10 rounded-lg px-0 text-xs font-bold"
              onClick={onNextClient}
              type="button"
            >
              {">"}
            </button>
          </div>
        </section>

        <div className="xl:col-span-5">
          <div className={filtersClassName}>{children}</div>
        </div>

        <CampaignSelectorCard
          campaigns={campaigns}
          className={campaignClassName}
          onChange={onChangeCampaign}
          selectedCampaignId={selectedCampaignId}
        />
      </div>
    </ModuleFiltersPanel>
  );
}
