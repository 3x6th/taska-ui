import { useOutletContext } from "react-router-dom";

/**
 * What a Company zone section may tell the zone's heading (TAS-513): an item
 * under the section — «Company › Billing › Invoice TSK-2026-01008» — and
 * what the heading is described by after a return from the payment page
 * (art-director B5, B11). `undefined` outside the zone.
 */
export interface CompanyZoneOutlet {
  setHeadingItem: (label: string | null) => void;
  setHeadingDescribedBy: (id: string | null) => void;
}

export const useCompanyZoneOutlet = () => useOutletContext<CompanyZoneOutlet | undefined>();

/** The zone's heading, for a section that puts focus there. */
export const zoneHeading = () => document.querySelector<HTMLElement>(".settings-area .area-section-title");
