import { useBalance } from "../store/Balance";

export default function Logo() {
    const balance = useBalance((s) => s.balance);
    return (
        <>
            <div className="absolute top-0 left-0 w-full flex justify-end">
                <img src="assets/logo.png" alt="Logo" className="w-[20%]" />
            </div>

            <div className="absolute top-0 left-0 w-full flex lg:ml-[32%] gap-5 mt-1">
                <div className="bg-[#071623] p-2 rounded-2xl border border-[#FABC34] font-bold text-xs">
                    {" "}
                    chUsd : {balance}
                </div>
                <div className="bg-[#071623] p-2 rounded-2xl border border-[#FABC34] font-bold text-xs">
                    {" "}
                    Demo GamePlay
                </div>
            </div>
        </>
    );
}

