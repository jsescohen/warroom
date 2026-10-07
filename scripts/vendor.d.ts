declare module 'd3-geo-projection' {
  import type { GeoProjection } from 'd3-geo';
  export function geoMiller(): GeoProjection;
}
declare module 'polylabel' {
  export default function polylabel(polygon: number[][][], precision?: number): [number, number] & { distance: number };
}
