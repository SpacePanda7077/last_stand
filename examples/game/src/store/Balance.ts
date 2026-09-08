import { create } from "zustand";

type BalnaceType = {
    balance: number;
    setBalance: (balance: number) => void;
};

export const useBalance = create<BalnaceType>((set) => ({
    balance: 10000,
    setBalance: (balance) => set({ balance }),
}));
