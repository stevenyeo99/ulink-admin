import logoUrl from '../../assets/ulink-logo.png';

export function Logo({ size = 36 }: { size?: number }) {
  return <img src={logoUrl} alt="Ulink" width={size} height={size} className="select-none" draggable={false} />;
}
