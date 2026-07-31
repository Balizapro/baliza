"use client";

import { useState, useEffect } from "react";

interface Escalon {
  id: string;
  escalon: number;
  nivel_min_m: number;
  nivel_max_m: number;
  confianza: number;
}

interface ConfigItem {
  clave: string;
  valor: string;
  descripcion?: string;
}

interface Usuario {
  id: string;
  email: string;
  nombre: string | null;
  rol: string | null;
  created_at: string;
  confirmed: boolean;
}

interface Props {
  umbralEval: { valor_m: number; descripcion: string } | null;
  umbralNR: { valor_m: number; descripcion: string } | null;
  trasladoMin: number;
  config?: ConfigItem[];
  onSaved: () => void;
  esAdmin?: boolean;
}

export default function AdminPanel({ umbralEval, umbralNR, trasladoMin, config, onSaved, esAdmin = false }: Props) {
  const [abiertoUmbrales, setAbiertoUmbrales] = useState(false);
  const [abiertoEscalones, setAbiertoEscalones] = useState(false);
  const [evalVal, setEvalVal] = useState(umbralEval?.valor_m?.toString() ?? "2.0");
  const [nrVal, setNrVal] = useState(umbralNR?.valor_m?.toString() ?? "2.2");
  const [traslado, setTraslado] = useState(trasladoMin.toString());
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  const [abiertoRecomendaciones, setAbiertoRecomendaciones] = useState(false);
  const [recVals, setRecVals] = useState<Record<string, string>>({});
  const [guardandoRec, setGuardandoRec] = useState(false);
  const [msgRec, setMsgRec] = useState("");

  const [abiertoUsuarios, setAbiertoUsuarios] = useState(false);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(false);
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [nuevoPass, setNuevoPass] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoRol, setNuevoRol] = useState("docente");
  const [creandoUsuario, setCreandoUsuario] = useState(false);
  const [msgUsu, setMsgUsu] = useState("");

  const recomendacionesKeys = [
    { clave: "recomendacion_verde", label: "Verde (normal)" },
    { clave: "recomendacion_amarilla", label: "Amarilla (atención)" },
    { clave: "recomendacion_roja_subiendo", label: "Roja (preparar salida)" },
    { clave: "recomendacion_roja_critico", label: "Roja (salir ahora)" },
    { clave: "recomendacion_verde_default", label: "Verde (por defecto)" },
  ];

  useEffect(() => {
    if (!abiertoRecomendaciones || Object.keys(recVals).length > 0) return;
    const vals: Record<string, string> = {};
    for (const { clave } of recomendacionesKeys) {
      vals[clave] = config?.find((c) => c.clave === clave)?.valor ?? "";
    }
    setRecVals(vals);
  }, [abiertoRecomendaciones, config]);

  async function guardarRecomendaciones() {
    setGuardandoRec(true);
    setMsgRec("");
    const errors: string[] = [];
    for (const { clave } of recomendacionesKeys) {
      const val = recVals[clave];
      if (val === undefined) continue;
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave, valor: val }),
      });
      if (!res.ok) errors.push(clave);
    }
    if (errors.length > 0) {
      setMsgRec("Error en: " + errors.join(", "));
    } else {
      setMsgRec("Guardado");
      onSaved();
    }
    setGuardandoRec(false);
  }

  useEffect(() => {
    if (!abiertoUsuarios) return;
    cargarUsuarios();
  }, [abiertoUsuarios]);

  async function cargarUsuarios() {
    setCargandoUsuarios(true);
    setMsgUsu("");
    const res = await fetch("/api/usuarios");
    const json = await res.json();
    if (json.error) {
      setMsgUsu(json.error);
    } else if (json.data) {
      setUsuarios(json.data);
    }
    setCargandoUsuarios(false);
  }

  async function crearUsuario() {
    setCreandoUsuario(true);
    setMsgUsu("");
    const res = await fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: nuevoEmail, password: nuevoPass, nombre: nuevoNombre, rol: nuevoRol }),
    });
    const json = await res.json();
    if (json.error) {
      setMsgUsu(json.error);
    } else {
      setMsgUsu("Usuario creado");
      setNuevoEmail("");
      setNuevoPass("");
      setNuevoNombre("");
      setNuevoRol("docente");
      await cargarUsuarios();
    }
    setCreandoUsuario(false);
  }

  const [escalones, setEscalones] = useState<Escalon[]>([]);
  const [cargandoEsc, setCargandoEsc] = useState(false);
  const [nuevoEscalon, setNuevoEscalon] = useState("");
  const [nuevoMin, setNuevoMin] = useState("");
  const [nuevoMax, setNuevoMax] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEscalon, setEditEscalon] = useState("");
  const [editMin, setEditMin] = useState("");
  const [editMax, setEditMax] = useState("");
  const [msgEsc, setMsgEsc] = useState("");

  useEffect(() => {
    if (!abiertoEscalones) return;
    cargarEscalones();
  }, [abiertoEscalones]);

  async function cargarEscalones() {
    setCargandoEsc(true);
    const res = await fetch("/api/escalones");
    const json = await res.json();
    if (json.data) setEscalones(json.data);
    setCargandoEsc(false);
  }

  async function agregarEscalon() {
    const escalon = parseInt(nuevoEscalon);
    const nivel_min_m = parseFloat(nuevoMin);
    const nivel_max_m = parseFloat(nuevoMax);
    if (isNaN(escalon) || isNaN(nivel_min_m) || isNaN(nivel_max_m)) {
      setMsgEsc("Valores inválidos"); return;
    }
    const res = await fetch("/api/escalones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ escalon, nivel_min_m, nivel_max_m }),
    });
    if (!res.ok) { setMsgEsc("Error al crear"); return; }
    setNuevoEscalon(""); setNuevoMin(""); setNuevoMax("");
    setMsgEsc("Creado");
    await cargarEscalones();
  }

  async function guardarEdicion(id: string) {
    const escalon = parseInt(editEscalon);
    const nivel_min_m = parseFloat(editMin);
    const nivel_max_m = parseFloat(editMax);
    if (isNaN(escalon) || isNaN(nivel_min_m) || isNaN(nivel_max_m)) {
      setMsgEsc("Valores inválidos"); return;
    }
    const res = await fetch(`/api/escalones/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ escalon, nivel_min_m, nivel_max_m }),
    });
    if (!res.ok) { setMsgEsc("Error al guardar"); return; }
    setEditingId(null);
    setMsgEsc("Guardado");
    await cargarEscalones();
  }

  async function eliminarEscalon(id: string) {
    if (!confirm("¿Eliminar este escalón?")) return;
    const res = await fetch(`/api/escalones/${id}`, { method: "DELETE" });
    if (!res.ok) { setMsgEsc("Error al eliminar"); return; }
    setMsgEsc("Eliminado");
    await cargarEscalones();
  }

  function iniciarEdicion(e: Escalon) {
    setEditingId(e.id);
    setEditEscalon(e.escalon.toString());
    setEditMin(e.nivel_min_m.toString());
    setEditMax(e.nivel_max_m.toString());
  }

  async function handleSave() {
    setGuardando(true);
    setMensaje("");
    const errors: string[] = [];

    const evalRes = await fetch("/api/umbrales", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "evaluacion", valor_m: parseFloat(evalVal) }),
    });
    if (!evalRes.ok) errors.push("evaluación");

    const nrRes = await fetch("/api/umbrales", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "no_retorno", valor_m: parseFloat(nrVal) }),
    });
    if (!nrRes.ok) errors.push("no retorno");

    const trasladoRes = await fetch("/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave: "tiempo_traslado_minutos", valor: traslado }),
    });
    if (!trasladoRes.ok) errors.push("traslado");

    if (errors.length > 0) {
      setMensaje("Error en: " + errors.join(", "));
    } else {
      setMensaje("Guardado");
      onSaved();
    }
    setGuardando(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <button
          onClick={() => setAbiertoUmbrales(!abiertoUmbrales)}
          className="w-full text-left flex items-center justify-between group"
        >
          <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400">
            Umbrales
          </p>
          <span className="text-[#5B6E68]/50 group-hover:text-[#5B6E68] dark:text-gray-500 transition-colors">{abiertoUmbrales ? "▲" : "▼"}</span>
        </button>

        {abiertoUmbrales && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">Evaluación (m)</label>
              <input
                type="number"
                step="0.01"
                value={evalVal}
                onChange={(e) => setEvalVal(e.target.value)}
                className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">No retorno (m)</label>
              <input
                type="number"
                step="0.01"
                value={nrVal}
                onChange={(e) => setNrVal(e.target.value)}
                className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">Tiempo de traslado (min)</label>
              <input
                type="number"
                value={traslado}
                onChange={(e) => setTraslado(e.target.value)}
                className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={guardando}
              className="bg-[#0E4749] text-white px-5 py-2.5 sm:px-4 sm:py-2 rounded-lg text-sm font-medium hover:bg-[#0E4749]/90 disabled:opacity-50 transition-colors"
            >
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
            {mensaje && (
              <p className={`text-sm ${mensaje === "Guardado" ? "text-[#4C7A5E] dark:text-green-400" : "text-[#C0442B] dark:text-red-400"}`}>{mensaje}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <button
          onClick={() => setAbiertoEscalones(!abiertoEscalones)}
          className="w-full text-left flex items-center justify-between group"
        >
          <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400">
            Escalones del muelle
          </p>
          <span className="text-[#5B6E68]/50 group-hover:text-[#5B6E68] dark:text-gray-500 transition-colors">{abiertoEscalones ? "▲" : "▼"}</span>
        </button>

        {abiertoEscalones && (
          <div className="mt-3 space-y-3">
            {cargandoEsc && <p className="text-xs italic text-[#5B6E68]/60 dark:text-gray-500">Cargando...</p>}

            {!cargandoEsc && escalones.length === 0 && (
              <p className="text-xs italic text-[#5B6E68]/60 dark:text-gray-500">No hay escalones cargados.</p>
            )}

            {escalones.map((e) => (
              <div key={e.id} className="border border-[#D4C9B8]/50 dark:border-gray-700 rounded-lg p-3 space-y-2">
                {editingId === e.id ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">Escalón</label>
                        <input type="number" value={editEscalon} onChange={(x) => setEditEscalon(x.target.value)}
                          className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded px-2 py-1 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">Min (m)</label>
                        <input type="number" step="0.01" value={editMin} onChange={(x) => setEditMin(x.target.value)}
                          className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded px-2 py-1 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">Max (m)</label>
                        <input type="number" step="0.01" value={editMax} onChange={(x) => setEditMax(x.target.value)}
                          className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded px-2 py-1 text-sm font-mono" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => guardarEdicion(e.id)}
                        className="bg-[#0E4749] text-white text-xs px-3 py-1.5 rounded hover:bg-[#0E4749]/90 transition-colors">Guardar</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-xs px-3 py-1.5 text-[#5B6E68] dark:text-gray-400 hover:text-[#12312B] dark:hover:text-gray-200">Cancelar</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-serif font-medium text-[#12312B] dark:text-gray-200">Escalón {e.escalon}</p>
                      <div className="flex gap-2">
                        <button onClick={() => iniciarEdicion(e)}
                          className="text-xs text-[#0E4749] dark:text-[#4fc3c5] hover:underline">Editar</button>
                        <button onClick={() => eliminarEscalon(e.id)}
                          className="text-xs text-[#C0442B] dark:text-red-400 hover:underline">Eliminar</button>
                      </div>
                    </div>
                    <p className="text-xs font-mono text-[#5B6E68] dark:text-gray-400">
                      {e.nivel_min_m.toFixed(2)} m — {e.nivel_max_m.toFixed(2)} m
                    </p>
                  </>
                )}
              </div>
            ))}

            <div className="pt-3 space-y-2">
              <p className="text-xs font-sans text-[#5B6E68] dark:text-gray-400 uppercase tracking-[0.15em]">Agregar escalón</p>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" placeholder="N°" value={nuevoEscalon} onChange={(x) => setNuevoEscalon(x.target.value)}
                  className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded px-2 py-1.5 text-sm font-mono" />
                <input type="number" step="0.01" placeholder="Min (m)" value={nuevoMin} onChange={(x) => setNuevoMin(x.target.value)}
                  className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded px-2 py-1.5 text-sm font-mono" />
                <input type="number" step="0.01" placeholder="Max (m)" value={nuevoMax} onChange={(x) => setNuevoMax(x.target.value)}
                  className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded px-2 py-1.5 text-sm font-mono" />
              </div>
              <button onClick={agregarEscalon}
                className="bg-[#0E4749] text-white text-xs px-4 py-1.5 rounded hover:bg-[#0E4749]/90 transition-colors">Agregar</button>
            </div>

            {msgEsc && (
              <p className={`text-xs ${msgEsc === "Error al crear" || msgEsc === "Error al guardar" || msgEsc === "Error al eliminar" || msgEsc === "Valores inválidos" ? "text-[#C0442B] dark:text-red-400" : "text-[#4C7A5E] dark:text-green-400"}`}>{msgEsc}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <button
          onClick={() => setAbiertoRecomendaciones(!abiertoRecomendaciones)}
          className="w-full text-left flex items-center justify-between group"
        >
          <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400">
            Recomendaciones
          </p>
          <span className="text-[#5B6E68]/50 group-hover:text-[#5B6E68] dark:text-gray-500 transition-colors">{abiertoRecomendaciones ? "▲" : "▼"}</span>
        </button>

        {abiertoRecomendaciones && (
          <div className="mt-3 space-y-3">
            {(recomendacionesKeys).map(({ clave, label }) => {
              const val = recVals[clave] ?? "";
              return (
                <div key={clave}>
                  <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">{label}</label>
                  <textarea
                    value={val}
                    onChange={(e) => setRecVals((prev) => ({ ...prev, [clave]: e.target.value }))}
                    className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm"
                    rows={2}
                  />
                </div>
              );
            })}
            <button
              onClick={guardarRecomendaciones}
              disabled={guardandoRec}
              className="bg-[#0E4749] text-white text-xs px-4 py-1.5 rounded hover:bg-[#0E4749]/90 disabled:opacity-50 transition-colors"
            >
              {guardandoRec ? "Guardando..." : "Guardar recomendaciones"}
            </button>
            {msgRec && (
              <p className={`text-xs ${msgRec === "Guardado" ? "text-[#4C7A5E] dark:text-green-400" : "text-[#C0442B] dark:text-red-400"}`}>{msgRec}</p>
            )}
          </div>
        )}
      </div>

      {esAdmin && (
        <div>
          <button
            onClick={() => setAbiertoUsuarios(!abiertoUsuarios)}
            className="w-full text-left flex items-center justify-between group"
          >
            <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400">
              Usuarios
            </p>
            <span className="text-[#5B6E68]/50 group-hover:text-[#5B6E68] dark:text-gray-500 transition-colors">{abiertoUsuarios ? "▲" : "▼"}</span>
          </button>

          {abiertoUsuarios && (
            <div className="mt-3 space-y-3">
              {cargandoUsuarios ? (
                <p className="text-xs italic text-[#5B6E68]/60 dark:text-gray-500">Cargando...</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-serif font-medium text-[#12312B] dark:text-gray-300">Cuentas existentes</p>
                  {usuarios.length === 0 ? (
                    <p className="text-xs italic text-[#5B6E68]/60 dark:text-gray-500">Sin usuarios</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {usuarios.map((u) => (
                        <div key={u.id} className="text-xs flex items-center justify-between border-b border-[#D4C9B8]/50 dark:border-gray-700 pb-1 last:border-0">
                          <span className="min-w-0">
                            <span className="font-medium text-[#12312B] dark:text-gray-200 block truncate">
                              {u.nombre ?? u.email}
                            </span>
                            <span className="font-mono text-[#5B6E68]/60 dark:text-gray-500 block truncate">{u.email}</span>
                          </span>
                          <span className="flex-shrink-0 ml-2 flex flex-col items-end gap-0.5">
                            <span className="text-[#5B6E68] dark:text-gray-400">{u.rol ?? "—"}</span>
                            <span className={`${u.confirmed ? "text-[#4C7A5E] dark:text-green-400" : "text-[#C99A3D]"}`}>
                              {u.confirmed ? "activo" : "pendiente"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-serif font-medium text-[#12312B] dark:text-gray-300">Crear cuenta</p>
                <input
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Nombre y apellido"
                  className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  value={nuevoEmail}
                  onChange={(e) => setNuevoEmail(e.target.value)}
                  placeholder="email@laconcepciondelta.edu.ar"
                  className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                />
                <input
                  type="password"
                  value={nuevoPass}
                  onChange={(e) => setNuevoPass(e.target.value)}
                  placeholder="Contraseña (mín 6 caracteres)"
                  className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                />
                <div>
                  <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1">Rol</label>
                  <select
                    value={nuevoRol}
                    onChange={(e) => setNuevoRol(e.target.value)}
                    className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="docente">Docente</option>
                    <option value="directivo">Directivo</option>
                    <option value="administrador">Administrador</option>
                  </select>
                </div>
                <button
                  onClick={crearUsuario}
                  disabled={creandoUsuario}
                  className="bg-[#0E4749] text-white text-xs px-4 py-1.5 rounded hover:bg-[#0E4749]/90 disabled:opacity-50 transition-colors"
                >
                  {creandoUsuario ? "Creando..." : "Crear usuario"}
                </button>
              </div>

              {msgUsu && (
                <p className={`text-xs ${msgUsu === "Usuario creado" ? "text-[#4C7A5E] dark:text-green-400" : "text-[#C0442B] dark:text-red-400"}`}>{msgUsu}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
