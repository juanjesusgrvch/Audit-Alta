import type { CampaignPeriod } from "@/lib/client/campaign-periods";

export function CampaignSelectorCard({
  campaigns,
  className = "",
  selectedCampaignId,
  onChange
}: {
  campaigns: CampaignPeriod[];
  className?: string;
  selectedCampaignId: string;
  onChange: (value: string) => void;
}) {
  const selectedCampaign =
    selectedCampaignId === "all"
      ? null
      : campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

  return (
    <section
      className={`aether-panel-soft rounded-lg px-4 py-4 ${className}`.trim()}
    >
      <label className="grid gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Campaña
        <select
          className="aether-field h-10 py-2 text-sm"
          onChange={(event) => onChange(event.target.value)}
          value={selectedCampaignId}
        >
          <option value="all">Todas</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.nombre}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 min-h-8 text-xs leading-5 text-[var(--text-muted)]">
        {selectedCampaign
          ? `${selectedCampaign.fechaDesde} a ${selectedCampaign.fechaHasta}`
          : campaigns.length > 0
            ? "Sin recorte de campaña."
            : "Configure periodos desde Opciones."}
      </p>
    </section>
  );
}
