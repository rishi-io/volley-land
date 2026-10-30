import type { Metadata } from 'next';
import { AdminApp } from '@/admin/AdminApp';

export const metadata: Metadata = {
  title: 'Volleyland admin',
  description: 'Game rules, rooms, bots and worlds.',
};

export default function AdminPage() {
  return <AdminApp />;
}
