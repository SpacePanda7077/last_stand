import { useBalance } from "../store/Balance";

export default function Logo() {
    const balance = useBalance((s) => s.balance);
    return (
        <>
            <div className="fixed top-0 left-0 w-full  flex justify-end z-100000000">
                <img src="assets/logo.png" alt="Logo" className="w-[20%]" />
            </div>

            <div className="fixed top-0 left-0 w-full flex  gap-5 mt-[3%] ml-5">
                <div className="bg-[#071623] p-2 rounded-2xl border border-[#FABC34] font-bold text-xs">
                    {" "}
                    chUsd : {balance.toFixed(2)}
                </div>
                <div className="bg-[#071623] p-2 rounded-2xl border border-[#FABC34] font-bold text-xs">
                    {" "}
                    Demo GamePlay
                </div>
            </div>
        </>
    );
}

