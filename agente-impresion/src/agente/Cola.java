package agente;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * Cola de impresión persistente: cada trabajo se guarda en cola/ (PDF + .properties con sus datos), así sobrevive a un
 * reinicio. Un solo hilo imprime en orden; si falla reintenta y, al agotar los reintentos, lo deja en error.
 */
public final class Cola {
    public static final class Trabajo {
        String id, documento, impresora, estado, error = "";
        long creado, impreso, proximoIntento;
        int intentos;

        Map<String, Object> aMapa() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id); m.put("documento", documento); m.put("impresora", impresora); m.put("estado", estado);
            m.put("intentos", intentos); m.put("error", error); m.put("creado", fecha(creado)); m.put("impreso", impreso > 0 ? fecha(impreso) : "");
            return m;
        }
    }

    private static final String PENDIENTE = "pendiente", IMPRIMIENDO = "imprimiendo", IMPRESO = "impreso", ERROR = "error";
    private final File carpeta;
    private final Config config;
    private final List<Trabajo> trabajos = new ArrayList<>();
    private int secuencia;

    public Cola(File base, Config config) {
        this.carpeta = new File(base, "cola");
        this.config = config;
        carpeta.mkdirs();
        cargar();
        Thread hilo = new Thread(this::procesar, "cola-impresion");
        hilo.setDaemon(true);
        hilo.start();
    }

    private void cargar() {
        File[] archivos = carpeta.listFiles((d, n) -> n.endsWith(".properties"));
        if (archivos == null) return;
        for (File f : archivos) {
            Properties p = new Properties();
            try (Reader r = new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8)) { p.load(r); } catch (IOException e) { continue; }
            Trabajo t = new Trabajo();
            t.id = p.getProperty("id");
            if (t.id == null || !pdf(t).exists()) { f.delete(); continue; }
            t.documento = p.getProperty("documento", "Ticket");
            t.impresora = p.getProperty("impresora", "");
            t.estado = p.getProperty("estado", PENDIENTE);
            if (IMPRIMIENDO.equals(t.estado)) t.estado = PENDIENTE; // se cortó a mitad: se vuelve a intentar
            t.error = p.getProperty("error", "");
            t.creado = Long.parseLong(p.getProperty("creado", "0"));
            t.impreso = Long.parseLong(p.getProperty("impreso", "0"));
            t.intentos = Integer.parseInt(p.getProperty("intentos", "0"));
            trabajos.add(t);
        }
        trabajos.sort(Comparator.comparing(t -> t.id));
        if (!trabajos.isEmpty()) Log.info("Cola recuperada: " + trabajos.size() + " trabajos");
    }

    /** Agrega un trabajo y devuelve sus datos; lanza IllegalStateException si la cola está llena. */
    public synchronized Trabajo agregar(byte[] pdf, String impresora, String documento) throws IOException {
        long abiertos = trabajos.stream().filter(t -> !IMPRESO.equals(t.estado)).count();
        if (abiertos >= config.maxTrabajos()) throw new IllegalStateException("La cola de impresión está llena (" + abiertos + " trabajos sin imprimir). Revisá la impresora.");
        Trabajo t = new Trabajo();
        t.id = new SimpleDateFormat("yyyyMMddHHmmssSSS").format(new Date()) + "-" + String.format("%03d", ++secuencia % 1000);
        t.documento = documento == null || documento.trim().isEmpty() ? "Ticket" : documento.trim();
        t.impresora = impresora == null ? "" : impresora.trim();
        t.estado = PENDIENTE;
        t.creado = System.currentTimeMillis();
        Files.write(pdf(t).toPath(), pdf);
        guardar(t);
        trabajos.add(t);
        Log.info("En cola " + t.id + ": " + t.documento + " -> " + nombreImpresora(t));
        notifyAll();
        return t;
    }

    public synchronized List<Map<String, Object>> listar() {
        List<Map<String, Object>> lista = new ArrayList<>();
        for (int i = trabajos.size() - 1; i >= 0; i--) lista.add(trabajos.get(i).aMapa());
        return lista;
    }

    public synchronized Map<String, Object> resumen() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pendientes", trabajos.stream().filter(t -> PENDIENTE.equals(t.estado) || IMPRIMIENDO.equals(t.estado)).count());
        m.put("errores", trabajos.stream().filter(t -> ERROR.equals(t.estado)).count());
        m.put("impresos", trabajos.stream().filter(t -> IMPRESO.equals(t.estado)).count());
        return m;
    }

    public synchronized Map<String, Object> buscar(String id) {
        Trabajo t = porId(id);
        return t == null ? null : t.aMapa();
    }

    /** Vuelve a poner en cola un trabajo con error (o reimprime uno ya impreso). */
    public synchronized boolean reintentar(String id) {
        Trabajo t = porId(id);
        if (t == null || IMPRIMIENDO.equals(t.estado)) return false;
        t.estado = PENDIENTE; t.intentos = 0; t.error = ""; t.proximoIntento = 0;
        guardar(t);
        notifyAll();
        return true;
    }

    public synchronized boolean eliminar(String id) {
        Trabajo t = porId(id);
        if (t == null || IMPRIMIENDO.equals(t.estado)) return false;
        borrar(t);
        return true;
    }

    private void procesar() {
        while (true) {
            Trabajo t;
            synchronized (this) {
                t = siguiente();
                if (t == null) {
                    try { wait(1000); } catch (InterruptedException e) { return; }
                    continue;
                }
                t.estado = IMPRIMIENDO;
                t.intentos++;
                guardar(t);
            }
            String error = "";
            try {
                byte[] pdf = Files.readAllBytes(pdf(t).toPath());
                Impresora.imprimir(pdf, nombreImpresora(t), t.documento);
            } catch (Throwable e) {
                error = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            }
            synchronized (this) {
                if (error.isEmpty()) {
                    t.estado = IMPRESO; t.impreso = System.currentTimeMillis(); t.error = "";
                    Log.info("Impreso " + t.id + ": " + t.documento + " -> " + nombreImpresora(t));
                } else if (t.intentos > config.reintentos()) {
                    t.estado = ERROR; t.error = error;
                    Log.error("Error " + t.id + " (" + t.intentos + " intentos): " + error);
                } else {
                    t.estado = PENDIENTE; t.error = error;
                    t.proximoIntento = System.currentTimeMillis() + config.esperaReintentoSeg() * 1000L;
                    Log.error("Falló " + t.id + ", se reintenta en " + config.esperaReintentoSeg() + " s: " + error);
                }
                guardar(t);
                limpiar();
            }
        }
    }

    private Trabajo siguiente() {
        long ahora = System.currentTimeMillis();
        for (Trabajo t : trabajos) if (PENDIENTE.equals(t.estado) && t.proximoIntento <= ahora) return t;
        return null;
    }

    /** Deja solo los últimos cola.maxTrabajos impresos (para reimprimir); borra los más viejos. */
    private void limpiar() {
        List<Trabajo> impresos = new ArrayList<>();
        for (Trabajo t : trabajos) if (IMPRESO.equals(t.estado)) impresos.add(t);
        for (int i = 0; i < impresos.size() - config.maxTrabajos(); i++) borrar(impresos.get(i));
    }

    private String nombreImpresora(Trabajo t) { return t.impresora.isEmpty() ? config.impresoraPorDefecto() : t.impresora; }
    private Trabajo porId(String id) { for (Trabajo t : trabajos) if (t.id.equals(id)) return t; return null; }
    private File pdf(Trabajo t) { return new File(carpeta, t.id + ".pdf"); }
    private File datos(Trabajo t) { return new File(carpeta, t.id + ".properties"); }

    private void borrar(Trabajo t) {
        trabajos.remove(t);
        pdf(t).delete();
        datos(t).delete();
    }

    private void guardar(Trabajo t) {
        Properties p = new Properties();
        p.setProperty("id", t.id); p.setProperty("documento", t.documento); p.setProperty("impresora", t.impresora);
        p.setProperty("estado", t.estado); p.setProperty("error", t.error == null ? "" : t.error);
        p.setProperty("creado", String.valueOf(t.creado)); p.setProperty("impreso", String.valueOf(t.impreso));
        p.setProperty("intentos", String.valueOf(t.intentos));
        try (Writer w = new OutputStreamWriter(new FileOutputStream(datos(t)), StandardCharsets.UTF_8)) {
            p.store(w, null);
        } catch (IOException e) {
            Log.error("No se pudo guardar el trabajo " + t.id + ": " + e.getMessage());
        }
    }

    static String fecha(long ms) { return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date(ms)); }
}
