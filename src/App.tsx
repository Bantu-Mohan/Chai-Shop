import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import DashboardLayout from './components/DashboardLayout/DashboardLayout';
import TableGrid from './components/TableGrid/TableGrid';
import OrderModal from './components/OrderModal/OrderModal';
import Notifications from './components/Notifications/Notifications';
import CustomerView from './components/CustomerView/CustomerView';
import Login from './components/Login/Login';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

// Sound effect hook
const NotificationSound = () => {
  const { state, dispatch } = useApp();
  const previousTables = React.useRef(state.tables);

  useEffect(() => {
    Object.keys(state.tables).forEach(key => {
      // ... same logic ...
      const current = state.tables[key];
      const prev = previousTables.current[key];

      if (current.status === 'ORDERED' && (!prev || prev.status !== 'ORDERED')) {
        const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3');
        audio.play().catch(e => console.log("Audio play failed", e));
        dispatch({ type: 'ADD_NOTIFICATION', payload: `Table ${key} has placed an order!` });
      }
    });
    previousTables.current = state.tables;
  }, [state.tables, dispatch]);

  return null;
};

const MainContent: React.FC = () => {
  const [tableId, setTableId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check URL for table param
    const params = new URLSearchParams(window.location.search);
    const tid = params.get('table');
    if (tid) setTableId(tid);

    // Initial Session Check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.2rem', color: '#666' }}>Loading...</div>;
  }

  // PUBLIC ROUTE: Customer View
  if (tableId) {
    return <CustomerView tableId={tableId} />;
  }

  // PROTECTED ROUTE: Staff Dashboard
  if (!session) {
    return <Login />;
  }

  return (
    <>
      <DashboardLayout>
        <TableGrid />
      </DashboardLayout>
      <OrderModal />
      <Notifications />
      <NotificationSound />
    </>
  );
};



const App: React.FC = () => {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
};

export default App;
