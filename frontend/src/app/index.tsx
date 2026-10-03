import { Redirect } from 'expo-router';

import { useSession } from '../session.tsx';

export default function Index() {
  const { session } = useSession();
  return <Redirect href={session ? '/tasks' : '/login'} />;
}
