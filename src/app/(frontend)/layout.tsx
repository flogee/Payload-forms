import type { Metadata } from 'next'
import './style.css'
export const metadata: Metadata = { title: 'Payload Forms · Befragungen', description: 'Formulare und Fragebogen-Pretests', robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="de"><body>{children}</body></html> }
