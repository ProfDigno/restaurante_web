package agente;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;

/**
 * Servidor HTTP local (solo 127.0.0.1). Atiende al sistema web (orígenes permitidos en config.properties)
 * y al panel local. Chrome exige CORS y Access-Control-Allow-Private-Network para que una página web llame a localhost.
 */
public final class Servidor {
    private final Config config;
    private final Cola cola;
    private final int puerto;

    public Servidor(Config config, Cola cola) throws IOException {
        this.config = config;
        this.cola = cola;
        this.puerto = config.puerto();
        HttpServer http = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), puerto), 20);
        http.createContext("/", this::atender);
        http.setExecutor(Executors.newFixedThreadPool(4));
        http.start();
        Log.info("Agente escuchando en http://127.0.0.1:" + puerto + "/ · orígenes permitidos: " + config.origenes());
    }

    public int puerto() { return puerto; }

    private void atender(HttpExchange ex) throws IOException {
        try {
            // Evita que otra página use el agente cambiando el DNS a 127.0.0.1 (DNS rebinding).
            String host = Optional.ofNullable(ex.getRequestHeaders().getFirst("Host")).orElse("").toLowerCase(Locale.ROOT);
            if (!host.equals("127.0.0.1:" + puerto) && !host.equals("localhost:" + puerto)) { responder(ex, 403, error("Host no permitido")); return; }
            String origen = ex.getRequestHeaders().getFirst("Origin");
            if (origen != null) {
                if (!origenPermitido(origen)) {
                    Log.error("Pedido rechazado desde " + origen + " (no está en 'origenes')");
                    responder(ex, 403, error("Este sitio no puede usar el agente de impresión. Agregalo en 'origenes' de config.properties."));
                    return;
                }
                ex.getResponseHeaders().set("Access-Control-Allow-Origin", origen);
                ex.getResponseHeaders().set("Vary", "Origin");
            }
            String metodo = ex.getRequestMethod().toUpperCase(Locale.ROOT);
            if (metodo.equals("OPTIONS")) {
                ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
                ex.getResponseHeaders().set("Access-Control-Allow-Private-Network", "true");
                ex.getResponseHeaders().set("Access-Control-Max-Age", "600");
                ex.sendResponseHeaders(204, -1);
                return;
            }
            enrutar(ex, metodo, ex.getRequestURI().getPath());
        } catch (IllegalArgumentException | IllegalStateException e) {
            responder(ex, 400, error(e.getMessage()));
        } catch (Exception e) {
            Log.error("Error atendiendo " + ex.getRequestURI() + ": " + e);
            responder(ex, 500, error("Error interno del agente: " + e.getMessage()));
        } finally {
            ex.close();
        }
    }

    private void enrutar(HttpExchange ex, String metodo, String ruta) throws Exception {
        Map<String, String> q = parametros(ex.getRequestURI().getRawQuery());
        if (metodo.equals("GET") && (ruta.equals("/") || ruta.equals("/panel"))) { panel(ex); return; }
        if (metodo.equals("GET") && ruta.equals("/estado")) { responder(ex, 200, Json.de(estado())); return; }
        if (metodo.equals("POST") && ruta.equals("/imprimir")) {
            byte[] pdf = leer(ex.getRequestBody(), config.maxBytes());
            if (pdf.length < 5 || !new String(pdf, 0, 5, StandardCharsets.ISO_8859_1).equals("%PDF-")) throw new IllegalArgumentException("El contenido no es un PDF");
            Cola.Trabajo t = cola.agregar(pdf, q.get("impresora"), q.get("documento"));
            responder(ex, 202, Json.de(cola.buscar(t.id)));
            return;
        }
        if (metodo.equals("GET") && ruta.equals("/cola")) { responder(ex, 200, Json.de(cola.listar())); return; }
        if (ruta.startsWith("/cola/")) {
            String[] partes = ruta.substring(6).split("/");
            String id = partes[0];
            if (metodo.equals("GET") && partes.length == 1) { Map<String, Object> t = cola.buscar(id); responder(ex, t == null ? 404 : 200, t == null ? error("Trabajo no encontrado") : Json.de(t)); return; }
            if (metodo.equals("DELETE") && partes.length == 1) { boolean r = cola.eliminar(id); responder(ex, r ? 200 : 404, r ? ok(true) : error("Trabajo no encontrado o imprimiéndose")); return; }
            if (metodo.equals("POST") && partes.length == 2 && partes[1].equals("reintentar")) { boolean r = cola.reintentar(id); responder(ex, r ? 200 : 404, r ? ok(true) : error("Trabajo no encontrado")); return; }
        }
        if (metodo.equals("GET") && ruta.equals("/config")) { responder(ex, 200, Json.de(config.todo())); return; }
        if (metodo.equals("PUT") && ruta.equals("/config")) {
            config.actualizar(parametros(new String(leer(ex.getRequestBody(), 64 * 1024), StandardCharsets.UTF_8)));
            Log.info("Configuración actualizada desde el panel");
            responder(ex, 200, Json.de(config.todo()));
            return;
        }
        responder(ex, 404, error("Ruta no encontrada"));
    }

    private Map<String, Object> estado() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("agente", "restaurante-web");
        m.put("version", Agente.VERSION);
        m.put("equipo", Agente.equipo());
        m.put("impresoras", Impresora.listar());
        m.put("impresoraPorDefecto", config.impresoraPorDefecto());
        m.put("predeterminadaWindows", Impresora.predeterminada());
        m.put("cola", cola.resumen());
        m.put("java", System.getProperty("java.version"));
        return m;
    }

    private boolean origenPermitido(String origen) {
        String o = origen.trim().replaceAll("/+$", "").toLowerCase(Locale.ROOT);
        return o.equals("http://127.0.0.1:" + puerto) || o.equals("http://localhost:" + puerto) || config.origenes().contains(o);
    }

    private void panel(HttpExchange ex) throws IOException {
        try (InputStream in = Servidor.class.getResourceAsStream("panel.html")) {
            byte[] html = leer(in, 1024 * 1024);
            ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            ex.getResponseHeaders().set("Cache-Control", "no-store");
            ex.sendResponseHeaders(200, html.length);
            try (OutputStream out = ex.getResponseBody()) { out.write(html); }
        }
    }

    private static Map<String, String> parametros(String crudo) throws IOException {
        Map<String, String> m = new HashMap<>();
        if (crudo == null || crudo.isEmpty()) return m;
        for (String par : crudo.split("&")) {
            int i = par.indexOf('=');
            String k = URLDecoder.decode(i < 0 ? par : par.substring(0, i), "UTF-8");
            String v = i < 0 ? "" : URLDecoder.decode(par.substring(i + 1), "UTF-8");
            m.put(k, v);
        }
        return m;
    }

    private static byte[] leer(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > max) throw new IllegalArgumentException("El archivo supera el máximo permitido (" + (max / 1024 / 1024) + " MB)");
        }
        return out.toByteArray();
    }

    private static String error(String mensaje) { return Json.de(Collections.singletonMap("error", mensaje)); }
    private static String ok(boolean v) { return Json.de(Collections.singletonMap("ok", v)); }

    private static void responder(HttpExchange ex, int estado, String json) throws IOException {
        byte[] cuerpo = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(estado, cuerpo.length);
        try (OutputStream out = ex.getResponseBody()) { out.write(cuerpo); }
    }
}
