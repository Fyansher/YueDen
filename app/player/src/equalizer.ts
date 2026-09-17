export const frequencies = [31.25,62.5,125,250,500,1000,2000,4000,8000,16000] as const;
export interface Equalizer { enabled: boolean; gains: number[]; preamp?:number; }
export function filter(value: Equalizer): string {
  if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.gains) || value.gains.length !== 10 || value.gains.some(g => !Number.isFinite(g) || g < -12 || g > 12 || !Number.isInteger(g * 2))) throw Error('均衡器参数无效');
  if(value.preamp!==undefined&&(!Number.isFinite(value.preamp)||value.preamp < -24||value.preamp > 12||!Number.isInteger(value.preamp*2)))throw Error('前置增益参数无效');
  if (!value.enabled) return '';
  // Unity by default. Limiter protects actual combined peaks without attenuating quiet bands.
  const preamp=value.preamp||0;
  const chain = [`volume=${preamp}dB`, ...frequencies.map((f,i) => `equalizer=f=${f}:t=o:w=1:g=${value.gains[i]}`), 'alimiter=limit=0.95:level=false'];
  return '@um_eq:lavfi=[' + chain.join(',') + ']';
}
