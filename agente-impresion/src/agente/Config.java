package agente;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Configuración del agente en config.properties (junto al .jar). Se puede editar a mano o desde el panel local. */
public final class Config {
    /** Clave, valor por defecto y explicación (en el orden en que se escriben en el archivo). */
    static final String[][] CLAVES = {
        {"puerto", "9123", "Puerto local donde escucha el agente (solo 127.0.0.1). Si se cambia, hay que reiniciar el agente."},
        {"origenes", "http://localhost:3003", "Direcciones del sistema que pueden imprimir, separadas por coma (ej.: https://hamburgus.ejemplo.com)."},
        {"impresoraPorDefecto", "", "Impresora a usar cuando el sistema no indica una. Vacío = impresora predeterminada de Windows."},
        {"cola.maxTrabajos", "50", "Trabajos impresos que se guardan para reimprimir; también es el máximo de trabajos pendientes."},
        {"cola.reintentos", "3", "Veces que se reintenta un trabajo que falla antes de dejarlo en error."},
        {"cola.esperaReintentoSeg", "10", "Segundos de espera entre reintentos."},
        {"cola.maxMB", "5", "Tamaño máximo de cada ticket en MB."},
        {"log.dias", "7", "Días que se guardan los archivos de log."},
    };

    private final File archivo;
    private final Properties valores = new Properties();

    public Config(File archivo) {
        this.archivo = archivo;
        for (String[] c : CLAVES) valores.setProperty(c[0], c[1]);
        if (archivo.exists()) {
            try (Reader r = new InputStreamReader(new FileInputStream(archivo), StandardCharsets.UTF_8)) {
                Properties leidas = new Properties();
                leidas.load(r);
                for (String k : leidas.stringPropertyNames()) valores.setProperty(k, leidas.getProperty(k).trim());
            } catch (IOException e) {
                Log.error("No se pudo leer " + archivo + ": " + e.getMessage());
            }
        } else {
            guardar();
        }
    }

    public synchronized String texto(String clave) { return valores.getProperty(clave, "").trim(); }

    public synchronized int entero(String clave, int min, int max) {
        try {
            int n = Integer.parseInt(texto(clave));
            return Math.max(min, Math.min(max, n));
        } catch (NumberFormatException e) {
            for (String[] c : CLAVES) if (c[0].equals(clave)) return Integer.parseInt(c[1]);
            return min;
        }
    }

    public int puerto() { return entero("puerto", 1024, 65535); }
    public String impresoraPorDefecto() { return texto("impresoraPorDefecto"); }
    public int maxTrabajos() { return entero("cola.maxTrabajos", 5, 1000); }
    public int reintentos() { return entero("cola.reintentos", 0, 20); }
    public int esperaReintentoSeg() { return entero("cola.esperaReintentoSeg", 1, 3600); }
    public int maxBytes() { return entero("cola.maxMB", 1, 50) * 1024 * 1024; }
    public int logDias() { return entero("log.dias", 1, 365); }

    public List<String> origenes() {
        List<String> lista = new ArrayList<>();
        for (String o : texto("origenes").split(",")) {
            String limpio = o.trim().replaceAll("/+$", "").toLowerCase(Locale.ROOT);
            if (!limpio.isEmpty()) lista.add(limpio);
        }
        return lista;
    }

    public synchronized Map<String, String> todo() {
        Map<String, String> mapa = new LinkedHashMap<>();
        for (String[] c : CLAVES) mapa.put(c[0], texto(c[0]));
        return mapa;
    }

    /** Actualiza solo las claves conocidas, valida los números y guarda el archivo. */
    public synchronized void actualizar(Map<String, String> nuevos) {
        for (String[] c : CLAVES) {
            String v = nuevos.get(c[0]);
            if (v == null) continue;
            v = v.trim().replace("\r", "").replace("\n", "");
            if (!c[0].equals("origenes") && !c[0].equals("impresoraPorDefecto")) {
                try { Integer.parseInt(v); } catch (NumberFormatException e) { throw new IllegalArgumentException(c[0] + ": debe ser un número entero"); }
            }
            valores.setProperty(c[0], v);
        }
        guardar();
    }

    private synchronized void guardar() {
        StringBuilder sb = new StringBuilder("# Agente de impresión de Restaurante Web\r\n# Se puede editar a mano (reiniciar el agente) o desde http://127.0.0.1:")
            .append(texto("puerto")).append("/\r\n\r\n");
        for (String[] c : CLAVES) {
            sb.append("# ").append(c[2]).append("\r\n");
            sb.append(c[0]).append('=').append(escapar(texto(c[0]))).append("\r\n\r\n");
        }
        try (Writer w = new OutputStreamWriter(new FileOutputStream(archivo), StandardCharsets.UTF_8)) {
            w.write(sb.toString());
        } catch (IOException e) {
            Log.error("No se pudo guardar " + archivo + ": " + e.getMessage());
        }
    }

    private static String escapar(String v) { return v.replace("\\", "\\\\"); }
}
