// Types for the vendored pico.js. Hand-written: upstream ships no types, and
// the surface used here is four functions.
declare const pico: {
  unpack_cascade(bytes: Int8Array): (r: number, c: number, s: number, pixels: Uint8Array, ldim: number) => number;
  run_cascade(
    image: { pixels: Uint8Array; nrows: number; ncols: number; ldim: number },
    classify: (r: number, c: number, s: number, pixels: Uint8Array, ldim: number) => number,
    params: { shiftfactor: number; minsize: number; maxsize: number; scalefactor: number }
  ): number[][];
  cluster_detections(dets: number[][], iouThreshold: number): number[][];
  instantiate_detection_memory(size: number): (dets: number[][]) => number[][];
};
export default pico;
