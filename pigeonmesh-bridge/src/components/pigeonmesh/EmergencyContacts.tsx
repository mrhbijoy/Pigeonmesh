"use client";

import { useState, useEffect } from "react";

// 3 main numbers
const default_numbers = [
    { service: "Police", number: "999" },
    { service: "Ambulance", number: "999" },
    { service: "Fire Brigade", number: "999" },
];

export default function EmergencyContacts() {
    const [isOpen, setIsOpen] = useState(false);
    const [isAdding, setIsAdding] = useState(false);

    const [service, setService] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");

    type Contact = {
        service: string;
        number: string;
    };

    const [contacts, setContacts] = useState<Contact[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem("emergencyContacts");

        if(!saved){
            return;
        }

        try{
            const parsed = JSON.parse(saved);

            if(Array.isArray(parsed)){
                const validContacts = parsed.filter(
                    (contact)=>
                        contact && 
                    typeof contact.service === "string" &&
                    typeof contact.number === "string"
                );

                setContacts(validContacts);

                //Save the cleaned list back to localStorage
                localStorage.setItem(
                    "emergencyContacts",
                    JSON.stringify(validContacts)
                );
            }
        }catch{
            //If localStorage contains invalid JSON
            localStorage.removeItem("emergencyContacts");
            setContacts([]);
        }
    }, []);


    const [editingIndex, setEditingIndex] = useState<number | null>(null);



    const saveContact = () => {
        if (!service.trim() || !phoneNumber.trim()) {
            return;
        }

        const cleanedNumber = phoneNumber.replace(/\s+/g, "");
        if (!/^\d+$/.test(cleanedNumber)) {
            return;
        }

        if (cleanedNumber.length < 10 || cleanedNumber.length > 15) {
            return;
        }

        const updatedContacts = [...contacts];

        if (editingIndex !== null) {
            //editing and existing contact
            updatedContacts[editingIndex] = {
                service: service.trim(),
                number: cleanedNumber,
            };
        } else {
            //adding a contact
            updatedContacts.push({
                service: service.trim(),
                number: cleanedNumber,
            });
        }

        setContacts(updatedContacts);

        localStorage.setItem("emergencyContacts", JSON.stringify(updatedContacts));

        setService("");
        setPhoneNumber("");
        setEditingIndex(null);
        setIsAdding(false);


    };



    const deleteContact = (index: number) => {
        const updateContacts = contacts.filter((_, i) => i !== index);

        setContacts(updateContacts);

        localStorage.setItem("emergencyContacts", JSON.stringify(updateContacts));
    };


    const cancelForm = () => {
        setService("");
        setPhoneNumber("");
        setEditingIndex(null);
        setIsAdding(false);
    }


    return (
        <div className="relative shrink-0">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-medium text-red-300"
            >
                🚨 Emergency
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-800 bg-slate-950 p-3 shadow-xl">
                    <h3 className="mb-3 text-sm font-semibold text-slate-200">
                        🚨 Emergency Contacts
                    </h3>

                    {default_numbers.map((contact) => (
                        <div
                            key={contact.service}
                            className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0"
                        >
                            <span className="text-xs text-slate-300">{contact.service}</span>
                            <a
                                href={`tel:${contact.number}`}
                                className="text-xs font-medium text-amber-400"
                            >
                                {" "}
                                📞 {contact.number}
                            </a>
                        </div>
                    ))}

                    {contacts.map((contact, index) => {

                        if (!contact) return null;
                        return (
                            <div
                                key={index}
                                className="flex items-center justify-between border-b border-slate-800 py-2" >
                                <span className="text-xs text-slate-300">{contact.service}</span>

                                <a
                                    href={`tel:${contact.number}`}
                                    className="text-xs font-medium text-amber-400"
                                >
                                    {" "}
                                    📞 {contact.number}
                                </a>

                                <button
                                    onClick={() => {
                                        setEditingIndex(index);
                                        setService(contact.service);
                                        setPhoneNumber(contact.number);
                                        setIsAdding(true);
                                    }}
                                    className="text-xs text-blue-400 hover:text-blue-300"
                                >
                                    ✏️
                                </button>

                                <button
                                    onClick={() => deleteContact(index)} className="text-xs text-red-400 hover:text-red-300"
                                >
                                    🗑️
                                </button>

                            </div>
                        );
                    })}

                    <button
                        onClick={() => setIsAdding(true)}
                        className="mt-3 w-full rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
                    >
                        + Add Contact
                    </button>

                    {isAdding && (
                        <div className="mt-3 border-t border-slate-800 pt-3">
                            <input
                                type="text"
                                placeholder="Service"
                                value={service}
                                onChange={(e) => setService(e.target.value)}
                                className="mb-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none"
                            />

                            <input
                                type="tel"
                                placeholder="Phone Number"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                className="mb-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none"
                            />

                            <div className="flex gap-2">
                                <button
                                    onClick={cancelForm}
                                    className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400"
                                >
                                    Cancel
                                </button>

                                <button
                                    onClick={saveContact}
                                    className="flex-1 rounded-lg bg-amber-500/20 px-3 py-2 text-xs text-amber-300"
                                >
                                    {" "}
                                    {editingIndex !== null ? "Save Changes" : "Add Contact"}{" "}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
