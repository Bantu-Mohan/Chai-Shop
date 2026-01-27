import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { AppState, Action, Table } from '../types';
import { supabase } from '../lib/supabase';

// Helper to deep compare tables for sync
const isEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

const INITIAL_TABLES: Record<string, Table> = {};
for (let i = 1; i <= 6; i++) {
    INITIAL_TABLES[i] = {
        status: 'EMPTY',
        items: [],
        notes: '',
        amount: 0,
        startedAt: null,
        lastPaid: null, // Initialize lastPaid
        paidOrders: [],
    };
}
const INITIAL_STATE: AppState = {
    shop: { name: 'Chai Tapri', totalTables: 6 },
    tables: INITIAL_TABLES,
    ui: { activeModal: null, notifications: [], selectedTableId: null },
};

// Reducer
function appReducer(state: AppState, action: Action | { type: 'UPDATE_TABLE_FROM_DB', payload: any }): AppState {
    switch (action.type) {
        case 'INIT_STATE': {
            // Used for initial load from DB
            return {
                ...state,
                tables: action.payload.tables,
                ui: state.ui
            };
        }

        case 'UPDATE_TABLE_FROM_DB': {
            const { id, ...data } = action.payload;
            // Merge DB data into local state
            // DB has 'paid_orders', app uses 'paidOrders'. Need to map if naming differs.
            // My schema used snake_case for DB columns mostly, but let's see. 
            // The subscription payload usually matches schema. 
            // My schema: items, amount, status, notes, last_paid, paid_orders
            // App types: items, amount, status, notes, lastPaid, paidOrders

            const table: Table = {
                status: data.status,
                items: data.items || [], // jsonb
                amount: data.amount,
                notes: data.notes,
                lastPaid: data.last_paid,
                paidOrders: data.paid_orders || [],
                startedAt: data.started_at,
            };

            return {
                ...state,
                tables: {
                    ...state.tables,
                    [id]: table
                }
            };
        }

        case 'SELECT_TABLE':
            return {
                ...state,
                ui: { ...state.ui, selectedTableId: action.payload, activeModal: 'ORDER' },
            };

        case 'CLOSE_MODAL':
            return {
                ...state,
                ui: { ...state.ui, activeModal: null, selectedTableId: null },
            };

        case 'UPDATE_TABLE_STATUS': {
            const { tableId, status } = action.payload;
            const currentTable = state.tables[tableId];

            // Logic to set lastPaid if status becomes PAID
            let lastPaid = currentTable.lastPaid;
            let paidOrders = currentTable.paidOrders || [];
            let items = currentTable.items;
            let amount = currentTable.amount;

            if (status === 'PAID') {
                lastPaid = (currentTable.lastPaid || 0) + currentTable.amount;
                // Create new PaidOrder
                const newOrder: any = { // Using any temporarily to avoid import mismatch for now, but strict type is PaidOrder
                    id: `paid-${Date.now()}`,
                    items: [...currentTable.items],
                    total: currentTable.amount,
                    timestamp: Date.now()
                };
                paidOrders = [...paidOrders, newOrder];
                items = []; // Clear items on Pay
                amount = 0; // Reset amount on Pay
            }

            return {
                ...state,
                tables: {
                    ...state.tables,
                    [tableId]: { ...currentTable, status, lastPaid, paidOrders, items, amount },
                },
            };
        }

        case 'ADD_ITEM': {
            const { tableId, item } = action.payload;
            const table = state.tables[tableId];
            const existingItemIndex = table.items.findIndex((i) => i.id === item.id);
            let newItems = [...table.items];

            if (existingItemIndex >= 0) {
                newItems[existingItemIndex].qty += item.qty;
            } else {
                newItems.push(item);
            }

            const newAmount = newItems.reduce((sum, i) => sum + i.price * i.qty, 0);

            return {
                ...state,
                tables: {
                    ...state.tables,
                    [tableId]: {
                        ...table,
                        items: newItems,
                        amount: newAmount,
                        status: table.status === 'EMPTY' ? 'ORDERED' : table.status, // Auto-switch status
                        startedAt: table.startedAt || Date.now(),
                        lastPaid: table.lastPaid,
                        paidOrders: table.paidOrders || [],
                    },
                },
            };
        }

        case 'REMOVE_ITEM': {
            const { tableId, itemId } = action.payload;
            const table = state.tables[tableId];
            const newItems = table.items.filter(i => i.id !== itemId);
            const newAmount = newItems.reduce((sum, i) => sum + i.price * i.qty, 0);
            return {
                ...state,
                tables: {
                    ...state.tables,
                    [tableId]: { ...table, items: newItems, amount: newAmount, lastPaid: table.lastPaid, paidOrders: table.paidOrders || [] }
                }
            };
        }

        case 'UPDATE_ITEM_QTY': {
            const { tableId, itemId, qty } = action.payload;
            if (qty <= 0) {
                const table = state.tables[tableId];
                const newItems = table.items.filter(i => i.id !== itemId);
                const newAmount = newItems.reduce((sum, i) => sum + i.price * i.qty, 0);
                return {
                    ...state,
                    tables: {
                        ...state.tables,
                        [tableId]: { ...table, items: newItems, amount: newAmount, lastPaid: table.lastPaid, paidOrders: table.paidOrders || [] }
                    }
                };
            }

            const table = state.tables[tableId];
            const newItems = table.items.map(i => i.id === itemId ? { ...i, qty } : i);
            const newAmount = newItems.reduce((sum, i) => sum + i.price * i.qty, 0);

            return {
                ...state,
                tables: {
                    ...state.tables,
                    [tableId]: { ...table, items: newItems, amount: newAmount, lastPaid: table.lastPaid, paidOrders: table.paidOrders || [] }
                }
            };
        }

        case 'CLEAR_TABLE': {
            return {
                ...state,
                tables: {
                    ...state.tables,
                    [action.payload]: {
                        status: 'EMPTY',
                        items: [],
                        notes: '',
                        amount: 0,
                        startedAt: null,
                        lastPaid: null,
                        paidOrders: [], // Reset
                    },
                },
                ui: { ...state.ui, activeModal: null, selectedTableId: null },
            };
        }

        case 'ADD_NOTIFICATION':
            return {
                ...state,
                ui: { ...state.ui, notifications: [...state.ui.notifications, action.payload] }
            };

        case 'DISMISS_NOTIFICATION':
            // Removes the first one
            return {
                ...state,
                ui: { ...state.ui, notifications: state.ui.notifications.slice(1) }
            };

        default:
            return state;
    }
}

// Context
const AppContext = createContext<{
    state: AppState;
    dispatch: React.Dispatch<Action | { type: 'UPDATE_TABLE_FROM_DB', payload: any }>;
}>({
    state: INITIAL_STATE,
    dispatch: () => undefined,
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
    const previousTables = useRef(state.tables);
    const isRemoteUpdate = useRef(false);

    // 1. Initial Load & Realtime Subscription
    useEffect(() => {
        const fetchState = async () => {
            const { data, error } = await supabase.from('tables').select('*');
            if (error) {
                console.error('Error fetching state:', error);
                return;
            }
            if (data && data.length > 0) {
                // Transform data array to object
                const tablesObj: Record<string, Table> = {};
                data.forEach((row: any) => {
                    tablesObj[row.id] = {
                        status: row.status,
                        items: row.items || [],
                        notes: row.notes,
                        amount: row.amount,
                        lastPaid: row.last_paid,
                        paidOrders: row.paid_orders || [],
                        startedAt: row.started_at,
                    };
                });

                // Merge with initial empty tables ensuring all 6 exist
                for (let i = 1; i <= 6; i++) {
                    if (!tablesObj[i]) {
                        tablesObj[i] = INITIAL_TABLES[i];
                    }
                }

                isRemoteUpdate.current = true;
                dispatch({ type: 'INIT_STATE', payload: { ...INITIAL_STATE, tables: tablesObj } });
                setTimeout(() => { isRemoteUpdate.current = false; }, 100);
            }
        };

        fetchState();

        const channel = supabase
            .channel('public:tables')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tables' },
                (payload) => {
                    console.log('Realtime update received:', payload);
                    if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                        isRemoteUpdate.current = true;
                        dispatch({ type: 'UPDATE_TABLE_FROM_DB', payload: payload.new });
                        setTimeout(() => { isRemoteUpdate.current = false; }, 100);
                    }
                }
            )
            .subscribe((status) => {
                console.log('Supabase Realtime Status:', status);
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // 2. Sync Local Changes to Supabase (Debounced)
    const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isRemoteUpdate.current) {
            // Update came from DB, so don't echo it back
            previousTables.current = state.tables;
            return;
        }

        const changesToSync: string[] = [];
        Object.keys(state.tables).forEach(key => {
            if (!isEqual(state.tables[key], previousTables.current[key])) {
                changesToSync.push(key);
            }
        });

        if (changesToSync.length > 0) {
            // Cancel previous pending sync
            if (persistTimer.current) clearTimeout(persistTimer.current);

            // Debounce: Wait 500ms after last change before sending to DB
            persistTimer.current = setTimeout(() => {
                changesToSync.forEach(key => {
                    const current = state.tables[key];
                    console.log(`Pushing update for table ${key} (Debounced)`);
                    supabase.from('tables').upsert({
                        id: key,
                        status: current.status,
                        items: current.items,
                        amount: current.amount,
                        notes: current.notes,
                        last_paid: current.lastPaid,
                        paid_orders: current.paidOrders,
                        started_at: current.startedAt
                    }).then(({ error }) => {
                        if (error) console.error('Supabase update failed:', error);
                    });
                });
            }, 500);
        }

        previousTables.current = state.tables;
    }, [state.tables]);

    return (
        <AppContext.Provider value={{ state, dispatch }}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => useContext(AppContext);

