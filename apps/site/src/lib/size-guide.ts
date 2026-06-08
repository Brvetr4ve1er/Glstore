/**
 * Size guide — measurements per oversize garment family.
 * Values are in CENTIMETRES. Source: typical Algerian streetwear
 * oversize spec; owners can tweak in this file (no rebuild needed
 * beyond the next deploy).
 */

export interface SizeRow {
  size: string;
  chest: number;     // chest width laid flat (cm)
  length: number;    // body length, shoulder to hem (cm)
  shoulder: number;  // shoulder seam to seam (cm)
  sleeve: number;    // sleeve length from shoulder (cm)
}

export interface SizeGuide {
  family: 'tshirt' | 'hoodie';
  label: string;
  rows: SizeRow[];
  fitNote: string;
  /** "Trouve ta taille" recommender → returns a size code from
   *  height (cm) + weight (kg). Tuned for oversize fit. */
  recommend: (heightCm: number, weightKg: number) => string;
}

export const SIZE_GUIDES: Record<'tshirt' | 'hoodie', SizeGuide> = {
  tshirt: {
    family: 'tshirt',
    label: 'T-shirt oversize',
    rows: [
      { size: 'S',   chest: 54, length: 70, shoulder: 54, sleeve: 22 },
      { size: 'M',   chest: 57, length: 73, shoulder: 57, sleeve: 23 },
      { size: 'L',   chest: 60, length: 75, shoulder: 60, sleeve: 24 },
      { size: 'XL',  chest: 63, length: 77, shoulder: 63, sleeve: 25 },
      { size: 'XXL', chest: 66, length: 79, shoulder: 66, sleeve: 26 },
    ],
    fitNote: 'Coupe oversize — prends ta taille habituelle pour un look ample, ou une taille en dessous si tu veux plus ajusté.',
    recommend: oversizeRecommender,
  },
  hoodie: {
    family: 'hoodie',
    label: 'Sweat / Pull oversize',
    rows: [
      { size: 'S',   chest: 58, length: 70, shoulder: 58, sleeve: 60 },
      { size: 'M',   chest: 61, length: 72, shoulder: 61, sleeve: 62 },
      { size: 'L',   chest: 64, length: 74, shoulder: 64, sleeve: 64 },
      { size: 'XL',  chest: 67, length: 76, shoulder: 67, sleeve: 66 },
      { size: 'XXL', chest: 70, length: 78, shoulder: 70, sleeve: 68 },
    ],
    fitNote: 'Coupe oversize avec poche kangourou. Prends ta taille habituelle pour un fit confortable.',
    recommend: oversizeRecommender,
  },
};

/** Body-mass-and-height oversize recommender, calibrated to the table
 *  above. Returns an "S" / "M" / "L" / "XL" / "XXL" code. */
function oversizeRecommender(heightCm: number, weightKg: number): string {
  if (!heightCm || !weightKg) return 'M';
  // weight is the dominant signal for oversize chest fit
  if (weightKg < 55)               return heightCm > 180 ? 'M' : 'S';
  if (weightKg < 65)               return heightCm > 185 ? 'L' : 'M';
  if (weightKg < 78)               return heightCm > 185 ? 'XL' : 'L';
  if (weightKg < 92)               return 'XL';
  return 'XXL';
}

/** Owner-editable in the future: drop this in content/size-guides/*.json
 *  and load via getCollection() if/when the shop wants to maintain the
 *  numbers from the /admin/ panel. Today they live here for simplicity. */
