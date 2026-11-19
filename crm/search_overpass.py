"""Bounded Overpass recovery, sequential requests and resumable area subdivision."""
from email.utils import parsedate_to_datetime
import time
import requests

QUERY_SECONDS = 60
HTTP_TIMEOUT = (10, 90)  # Query runtime + queue/network margin.
RETRY_DELAYS = (20, 60)


class OverpassEmEspera(requests.RequestException):
    """Instances are cooling down; leave these queries pending."""


class ConsultaPesada(requests.RequestException):
    """A query timed out or exceeded the provider's execution/memory limit."""


def query_overpass(bbox, filters):
    bounds = ",".join(str(value) for value in bbox)
    selectors = []
    for alternatives in filters:
        tags = "".join(f'["{key}"="{value}"]' for key, value in alternatives)
        selectors.extend(f"{kind}{tags}({bounds});" for kind in ("node", "way", "relation"))
    return f'[out:json][timeout:{QUERY_SECONDS}];\n(\n' + "\n".join(selectors) + '\n);\nout center tags;'


def split_bbox(bbox):
    south, west, north, east = bbox
    if not south < north or not west < east:
        raise ValueError("Área inválida para subdivisão")
    latitude, longitude = (south + north) / 2, (west + east) / 2
    return [(south, west, latitude, longitude), (south, longitude, latitude, east),
            (latitude, west, north, longitude), (latitude, longitude, north, east)]


def unique_elements(elements):
    unique = {}
    for element in elements:
        if not isinstance(element, dict) or "type" not in element or "id" not in element:
            raise requests.RequestException("Elemento OSM incompleto")
        unique[(element["type"], element["id"])] = element
    return list(unique.values())


def retry_cities(cities, completed, wait, delays=RETRY_DELAYS, log=print):
    """At most three passes; completed cities/categories are never requested again."""
    for round_index in range(len(delays) + 1):
        pending = [(index, city) for index, city in enumerate(cities) if city not in completed]
        if not pending:
            return
        if round_index:
            seconds = delays[round_index - 1]
            log(f"Retomada {round_index}/{len(delays)}: {len(pending)} cidades com consultas pendentes; espera de {seconds}s.")
            wait(seconds)
        for index, city in pending:
            if city not in completed:
                yield index, city


class OverpassClient:
    def __init__(self, urls, session, invoke, check_stop, wait, log=print, now=time.monotonic):
        self.urls = list(dict.fromkeys(urls))
        self.session, self.invoke, self.check_stop = session, invoke, check_stop
        self.wait, self.log, self.now = wait, log, now
        self.state = {url: {"failures": 0, "retry_at": 0} for url in self.urls}

    def _failure(self, url, error):
        state = self.state[url]
        state["failures"] += 1
        delay = min(300, 20 * 2 ** min(state["failures"] - 1, 4))
        response = getattr(error, "response", None)
        retry_after = response.headers.get("Retry-After") if response is not None else None
        if retry_after:
            try:
                server_delay = float(retry_after)
            except ValueError:
                try:
                    server_delay = parsedate_to_datetime(retry_after).timestamp() - time.time()
                except (ValueError, TypeError, OverflowError):
                    server_delay = 0
            delay = max(delay, server_delay)
        state["retry_at"] = self.now() + delay
        self.log(f"Fonte OSM em espera por {delay:.0f}s: {url} ({error})")

    def _query(self, bbox, filters):
        self.check_stop()
        available = sorted((url for url in self.urls if self.state[url]["retry_at"] <= self.now()),
                           key=lambda url: self.state[url]["failures"])
        if not available:
            raise OverpassEmEspera("Fontes OSM em recuperação; consultas continuam pendentes.")
        for url in available:
            self.check_stop()
            response = None
            try:
                response = self.invoke(self.session.post, url, data={"data": query_overpass(bbox, filters)}, timeout=HTTP_TIMEOUT)
                response.raise_for_status()
                data = response.json()
                if isinstance(data, dict) and data.get("remark"):
                    remark = str(data["remark"])
                    if any(text in remark.lower() for text in ("timed out", "timeout", "out of memory", "memory limit")):
                        raise ConsultaPesada(remark)
                    raise requests.RequestException("Consulta incompleta: " + remark)
                if not isinstance(data, dict) or not isinstance(data.get("elements"), list):
                    raise requests.RequestException("Resposta OSM incompleta")
                elements = unique_elements(data["elements"])
                self.state[url] = {"failures": 0, "retry_at": 0}
                return elements
            except requests.ReadTimeout as error:
                self._failure(url, error)
                raise ConsultaPesada("Consulta excedeu o tempo de leitura") from error
            except ConsultaPesada:
                raise
            except (ValueError, requests.RequestException) as error:
                status = getattr(getattr(error, "response", None), "status_code", None)
                if status is not None and 400 <= status < 500 and status not in (408, 429):
                    raise
                self._failure(url, error)
            finally:
                if response is not None:
                    response.close()
        raise OverpassEmEspera("Nenhuma fonte OSM respondeu nesta tentativa; consultas preservadas para retomada.")

    def search(self, bbox, filters, progress=None, save=None):
        progress = progress if progress is not None else {}
        if progress.get("bbox") != list(bbox) or not isinstance(progress.get("parts"), dict):
            progress.clear()
            try:
                return self._query(bbox, filters)
            except ConsultaPesada:
                self.log("Consulta pesada: dividindo a mesma área em quatro partes, sem reduzir a cobertura.")
                progress.update({"bbox": list(bbox), "parts": {}})
                if save:
                    save()
        parts = progress["parts"]
        elements = []
        for index, area in enumerate(split_bbox(bbox)):
            self.check_stop()
            key = str(index)
            if not isinstance(parts.get(key), list):
                self.log(f"Consultando parte {index + 1}/4 da área OSM.")
                parts[key] = self._query(area, filters)
                if save:
                    save()
                self.wait(1)
            else:
                self.log(f"Parte {index + 1}/4 já salva; consulta não repetida.")
            elements.extend(parts[key])
        return unique_elements(elements)
